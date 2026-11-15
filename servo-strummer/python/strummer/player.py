"""The bar loop: what the robot plays, bar by bar.

It never pushes anything itself: it reports through `on_bar(bar)` at each bar start and
`on_state(state)` whenever the playing state changes, and the web layer forwards those.

With SEQUENCER on, the MCU plays the bars itself (sketch/sequencer.h): Python queues one bar
ahead, and the board's "bar" notification at each bar start is the cue to queue the next.
Pattern, chord, song and tempo changes re-queue the waiting bar, so they land on the next bar
line. If notifications don't arrive, the player polls the board's "seq" state instead. In
debug mode (servos off) nothing reaches the board's sequencer: SimBars keeps bar time here.
"""

import queue
import threading
import time

from .music import BAR_BEATS, CHORDS, PATTERNS, RANDOM, bar, bar_chord, encode_bar, next_pattern, parse_song
from .music import chunk_ms, to_chunks, to_steps

SEQUENCER = True     # False = the old path: Python sends each bar to the board in chunks
NOTIFY_WAIT_S = 1.5  # no "bar" notification this long after start: poll instead
POLL_S = 0.05        # how often to poll the board's sequencer state in the fallback


def _ignore(_):
    pass


class SimBars:
    """Debug mode's stand-in for the board's sequencer: a "bar" event every bar, at the knob's
    tempo (or the page's when no knob is in), and "stopped" when the knob is at 0."""

    def __init__(self, events, board, page_bpm):
        self.events, self.board, self.page_bpm = events, board, page_bpm
        self.halt = threading.Event()

    def start(self, bpm):
        threading.Thread(target=self._run, args=(bpm,), daemon=True).start()

    def stop(self):
        self.halt.set()

    def _run(self, bpm):
        n = 0
        while not self.halt.is_set():
            if n:
                knob = self.board.knob_bpm_now()
                bpm = knob if knob is not None else self.page_bpm()
            if bpm == 0:
                self.events.put(("stopped",))
                return
            self.events.put(("bar", n, bpm))
            n += 1
            self.halt.wait(BAR_BEATS * 60 / bpm)


class Player:
    def __init__(self, board, on_bar=_ignore, on_state=_ignore):
        self.board = board
        self.on_bar = on_bar
        self.on_state = on_state
        self.stop = threading.Event()
        # playing = pattern name; bar = the bar the robot is playing now, so the page can mirror it;
        # song = a loaded chord progression (one chord per bar), used while no chord is chosen;
        # talk = times the knob was pressed to talk (the page starts listening when it goes up)
        self.state = {"playing": None, "chord": None, "bpm": 90, "knob_bpm": None, "bar": None, "song": None,
                      "talk": 0}
        self.events = queue.Queue()  # the sequencer loop's inbox: board notifications and page changes
        self.thread = None
        self.song, self.bar_no = None, 0
        # Notification handlers only queue an event: calling the board back from inside one
        # could deadlock the Bridge.
        heard = [board.listen("bar", lambda n, bpm: self.events.put(("bar", int(n), int(bpm)))),
                 board.listen("knob_gesture", lambda g: self.events.put(("knob", int(g)))),
                 board.listen("stopped", lambda *_: self.events.put(("stopped",)))]
        self.polling = not all(heard)

    def changed(self):
        self.on_state(self.state)

    def set_knob_bpm(self, knob):
        """Record the knob's tempo; tells on_state only when it moved."""
        if knob != self.state["knob_bpm"]:
            self.state["knob_bpm"] = knob
            self.changed()

    def knob_gesture(self, gesture):
        """The knob's button. 1 = press: the page starts listening for a voice command.
        -1 = double tap: next pattern (only while playing)."""
        if gesture == 1:
            self.state["talk"] += 1
            print("knob press: talk", flush=True)
            self.changed()
        elif gesture == -1 and self.state["playing"]:
            self.state["playing"] = next_pattern(self.state["playing"])
            print(f"knob double tap: {self.state['playing']!r}", flush=True)
            self.changed()

    # --- the sequencer loop (SEQUENCER = True) ---

    def _make_bar(self):
        """The bar to queue next: song bar `self.bar_no` of the current pattern."""
        state = self.state
        if state["song"] is not self.song:  # a newly loaded song starts from its first chord
            self.song, self.bar_no = state["song"], 0
        name = state["playing"]
        events = bar(name)
        chord = bar_chord(name, state["chord"], self.bar_no, self.song)
        # next: the chord of the bar after this one, so the page can call it out in time
        # no: which bar of the song this is (it keeps counting past the end; the song loops)
        return {"events": events, "chord": chord, "code": encode_bar(events, chord), "no": self.bar_no,
                "next": bar_chord(name, state["chord"], self.bar_no + 1, self.song)}

    def _poll(self, seen):
        """Polling fallback: turn the board's sequencer state into the events notify would send."""
        running, n, bpm, count, gesture = self.board.seq_state()
        if seen.get("count") is not None and count != seen["count"] and gesture:
            self.events.put(("knob", gesture))
        seen["count"] = count
        if n >= 0 and n != seen.get("bar"):
            seen["bar"] = n
            self.events.put(("bar", n, bpm))
        if not running:
            self.events.put(("stopped",))

    def _play_seq(self):
        board, state = self.board, self.state
        sim = None
        try:
            print(f"play start (sequencer): {state['playing']!r}", flush=True)
            knob = board.knob_bpm_now()
            self.set_knob_bpm(knob)
            bpm = knob if knob is not None else state["bpm"]
            if bpm == 0:
                print("knob at 0: not starting", flush=True)
                return
            board.send_angles_now()
            self.song, self.bar_no = state["song"], 0
            upcoming = self._make_bar()
            if board.servos:
                if not board.queue_bar(upcoming["code"], state["bpm"]):
                    raise RuntimeError(f"board refused the bar {upcoming['code']!r}")
                if not board.start_bars(bpm):
                    raise RuntimeError("board refused to start")
            else:
                sim = SimBars(self.events, board, lambda: state["bpm"])
                sim.start(bpm)
            polling = self.polling and sim is None
            started, heard, seen = time.time(), False, {}
            while True:
                try:
                    ev = self.events.get(timeout=POLL_S if polling else 0.5)
                except queue.Empty:
                    if polling:
                        self._poll(seen)
                    elif sim is None and not heard and time.time() - started > NOTIFY_WAIT_S:
                        print("no bar notification from the board: polling its state instead", flush=True)
                        self.polling = polling = True
                    continue
                kind = ev[0]
                if kind == "stop":
                    break
                if kind == "stopped":
                    print("knob at 0: stopped", flush=True)
                    break
                if kind == "bar":
                    heard = True
                    _, n, bar_bpm = ev
                    current = upcoming
                    board.show_chord_now(current["chord"])
                    if knob is not None:
                        self.set_knob_bpm(bar_bpm)
                    state["bar"] = {"start": time.time(), "chord": current["chord"], "next": current["next"],
                                    "no": current["no"],
                                    "steps": to_steps(current["events"], bar_bpm, current["chord"])}
                    self.on_bar(state["bar"])
                    self.bar_no += 1
                elif kind == "knob":  # 1 = press: talk, -1 = double tap: next pattern
                    self.knob_gesture(ev[1])
                if sim is None and not board.servos:  # debug mode switched on mid-play
                    print("servos off: the board stops, bar time carries on here", flush=True)
                    board.stop_bars()
                    sim = SimBars(self.events, board, lambda: state["bpm"])
                    sim.start(state["knob_bpm"] or state["bpm"])
                # a bar started, or something changed: (re)queue the bar after the current one
                upcoming = self._make_bar()
                if sim is None and not board.queue_bar(upcoming["code"], state["bpm"]):
                    print(f"board refused the bar {upcoming['code']!r}: it keeps looping the last one", flush=True)
            print("play end", flush=True)
        except Exception as e:
            print(f"play error: {e!r}", flush=True)
        finally:
            if sim:
                sim.stop()
            else:
                try:
                    board.stop_bars()  # the board keeps exact pulses 300 ms, then goes quiet
                except Exception as e:
                    print(f"stop error: {e!r}", flush=True)
            state["playing"] = None
            state["bar"] = None
            self.changed()

    # --- the old chunk loop (SEQUENCER = False), unchanged; it holds the board lock throughout ---

    def _play(self):
        board, state = self.board, self.state
        try:
            print(f"play start: {state['playing']!r}", flush=True)
            first = True
            bar_no = 0
            board.send_angles()
            song = state["song"]
            while not self.stop.is_set():
                # Pattern, tempo and chord are re-read every bar, so switching patterns, the knob
                # and the camera all take effect at the next bar line.
                gesture = board.knob_click()  # 1 = press: talk, -1 = double tap: next pattern
                if gesture and not first:  # on the first bar it's a stale press from before Play
                    self.knob_gesture(gesture)
                first = False
                name = state["playing"]
                if state["song"] is not song:  # a newly loaded song starts from its first chord
                    song, bar_no = state["song"], 0
                chord = bar_chord(name, state["chord"], bar_no, song)
                bar_no += 1
                board.show_chord(chord)
                knob = board.knob_bpm()
                self.set_knob_bpm(knob)
                bpm = knob if knob is not None else state["bpm"]
                if bpm == 0:
                    print("knob at 0: stopping", flush=True)
                    break
                steps = to_steps(bar(name), bpm, chord)
                # next: the chord of the bar after this one, so the page can call it out in time
                state["bar"] = {"start": time.time(), "steps": steps, "chord": chord, "no": bar_no - 1,
                                "next": bar_chord(name, state["chord"], bar_no, song)}
                self.on_bar(state["bar"])
                for chunk in to_chunks(steps):
                    if self.stop.is_set():
                        break
                    # The sketch plays the whole chunk before replying; nothing else is sent meanwhile,
                    # since a message arriving mid-pulse could be garbled on the MCU.
                    board.servo_play(chunk, timeout=chunk_ms(chunk) / 1000 + 5)
            print("play end", flush=True)
        except Exception as e:
            print(f"play error: {e!r}", flush=True)
        finally:
            try:
                # Keep exact pulses 300 ms so the last-plucked strings finish their swing,
                # then the board sends nothing until the next pattern.
                board.servo_play("0:300")
            except Exception as e:
                print(f"tail error: {e!r}", flush=True)
            state["playing"] = None
            state["bar"] = None
            board.lock.release()
            self.changed()

    # --- requests ---

    def play(self, pattern):
        if pattern not in PATTERNS and pattern != RANDOM:
            return {"ok": False, "error": "unknown pattern"}
        if self.state["playing"] and not self.stop.is_set():
            self.state["playing"] = pattern  # already playing: switch at the next bar
            self.changed()
            self.events.put(("change",))
            return {"ok": True, "switched": True}
        if self.thread and self.thread.is_alive():
            self.thread.join(0.5)  # still stopping
            if self.thread.is_alive():
                return {"ok": False, "error": "busy"}
        if not SEQUENCER and not self.board.lock.acquire(timeout=0.5):  # a status poll may hold it
            return {"ok": False, "error": "busy"}
        self.stop.clear()
        while not self.events.empty():  # leftovers from the last run
            self.events.get_nowait()
        self.state["playing"] = pattern
        self.changed()
        self.thread = threading.Thread(target=self._play_seq if SEQUENCER else self._play, daemon=True)
        self.thread.start()
        return {"ok": True}

    def stop_playing(self):
        self.stop.set()  # old path: after the chunk on the board; sequencer: at once
        self.events.put(("stop",))
        return {"ok": True}

    def settings_changed(self):
        self.changed()
        if self.state["playing"]:
            self.events.put(("change",))  # re-queue the waiting bar

    def set_chord(self, name=""):
        # Empty name = no chord: every string plays.
        if name and name not in CHORDS:
            return {"ok": False, "error": "unknown chord"}
        self.state["chord"] = name or None
        self.settings_changed()
        return {"ok": True}

    def set_song(self, chords=""):
        # "Am,G,C,C": one chord per bar, looping. Empty = no song. It plays while no chord is
        # chosen; a chord from the page, camera or microphone still wins, bar by bar.
        names, error = parse_song(chords)
        if error:
            return {"ok": False, "error": error}
        self.state["song"] = names or None
        self.settings_changed()
        return {"ok": True, "song": self.state["song"]}

    def set_tempo(self, bpm):
        # Used when no knob is plugged in.
        self.state["bpm"] = min(max(bpm, 30), 200)
        self.settings_changed()
        return {"ok": True}

    def steps(self, pattern, bpm=90, chord="", bar_no=0):
        """One bar of steps for the page's virtual guitar, made exactly as the robot's are."""
        if pattern not in PATTERNS and pattern != RANDOM:
            return {"ok": False, "error": "unknown pattern"}
        if chord and chord not in CHORDS:
            return {"ok": False, "error": "unknown chord"}
        chosen, song = chord or None, self.state["song"]
        chord = bar_chord(pattern, chosen, bar_no, song)
        return {"ok": True, "chord": chord, "next": bar_chord(pattern, chosen, bar_no + 1, song),
                "steps": to_steps(bar(pattern), min(max(bpm, 30), 200), chord)}
