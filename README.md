# Solo Strings

A guitar that strums itself. Six servos sit over the strings, one per string, and an Arduino UNO Q
tells each one when to pluck. Built in a weekend at DurHack 2026.

This branch is the Arduino part on its own: the sketch that runs on the UNO Q's microcontroller,
and a small Python player that feeds it bars from the board's Linux side. The full hackathon app
(web page, lessons, voice coach) is on the [`main`](https://github.com/JiSukh/SoloStrings_DurHack26/tree/main) branch.

The robot has no fretting hand. You hold the chord and it strums.

## What's here

| Path | What it is |
|---|---|
| `solo-strings/sketch/` | The sketch for the microcontroller: servo pulses, the bar sequencer, the knob, the LED matrix |
| `solo-strings/python/` | The player for the Linux side: patterns, chords, and the loop that queues bars |
| `solo-strings/app.yaml` | Makes the folder an Arduino App Lab app |
| `tests/`, `scripts/test.sh` | Tests that run on a PC, no board needed |
| `scripts/package.sh` | Builds `solo-strings.zip` for App Lab's import |

## Parts

- Arduino UNO Q
- 6 × SG90 servo, each with a pick on its arm
- A separate 5 V supply for the servos
- A 3D-printed mount that holds the servos over the strings
- Optional: Modulino Knob on the Qwiic connector, for tempo

## Wiring

| String | Servo signal pin |
|---|---|
| Low E | D2 |
| A | D4 |
| D | D7 |
| G | D8 |
| B | D12 |
| High e | D13 |

- **Signal:** each servo's signal wire goes to its pin above.
- **Power:** each servo's power wire goes to the separate 5 V supply, not to the board's 5 V pin.
  SG90s can pull over half an amp each when they stall, so use a supply rated for at least 3 A.
- **Ground:** join the supply's ground to a GND pin on the UNO Q. Without the shared ground the
  servos ignore the signal or twitch.

To use other pins, change `SERVO_PINS` at the top of `sketch.ino`. The first pin is the low E.

## Install and run

**With App Lab:** import `solo-strings.zip` (from this release, or build it with
`scripts/package.sh`), open the app and press Run. App Lab uploads the sketch and starts the
Python side.

**From a terminal**, with the board on USB (`adb` comes with the UNO Q board package):

```sh
adb push solo-strings /home/arduino/ArduinoApps/
adb shell arduino-app-cli app start user:solo-strings
adb shell arduino-app-cli app logs user:solo-strings
```

On start, every pick moves to its start side. Then the player strums the pattern set in
`python/main.py`, and the log prints a line per bar.

## Changing what it plays

Edit the three settings at the top of `solo-strings/python/main.py` and restart the app:

```python
PATTERN = "Folk (D DU UDU)"  # any name in strummer/music.py's PATTERNS, or "Random"
SONG = "Am, G, C, C"         # one chord per bar, looping; "" = strum every string
BPM = 90                     # 30 to 200; ignored while a knob is plugged in
```

- **Patterns:** Strum, Down-up eighths, Folk (D DU UDU), Riptide, Travis picking, Arpeggio up,
  Arpeggio down, Arpeggio up-down, Rising Sun arpeggio, Boom-chick, Fingerstyle p-i-m-a,
  Pinch pattern, Reggae skank, Rock eighths (bass + chop), Super-human (32nds), Random.
  Add your own in `strummer/music.py`.
- **Chords:** C, G, D, A, E, Am, Em, Dm, F, Bm, A7, B7, C7, D7, E7, G7, Fmaj7, Cadd9, Asus2, Dsus4.
  The chord decides which strings are skipped and which string is the bass note. Its name is
  shown on the board's LED matrix.

## The knob (optional)

Plug a Modulino Knob into the Qwiic connector before starting the app.

- **Turn:** tempo, 0 to 200 BPM in steps of 5. It starts at 90. A new tempo takes effect on the
  next beat.
- **Turn to 0:** stops at the next beat. Turn it back up to start again.
- **Double tap:** next pattern, from the next bar.

With a knob plugged in, the knob's tempo always wins over `BPM`.

## Calibrating the picks

Each pluck swings a pick from one side of its string to the other, so every string has two rest
angles: side A and side B. Both default to 60° and 120°.

Set them per string with the `angles` command (below), or change `SIDE_A` and `SIDE_B` in
`sketch.ino`. Limits: A at least 10°, B at most 170°, and at least 10° between them. A small swing
is faster. Each string needs about 160 ms between its own plucks for an SG90 to get back past it.

## How the sketch works

- **Frames:** the loop runs once every 20 ms. Each frame it works out which strings to pluck,
  sends one pulse to every servo, then reads the knob and updates the LED matrix in the gap.
- **Pulses:** the sketch makes the servo pulses itself instead of using the Servo library, whose
  timer gets delayed by other interrupts and makes the servos twitch.
- **Bars:** the Linux side sends one bar of music at a time. The sketch plays it and loops it
  until another bar is queued, then swaps at the bar line. If the Linux side goes quiet, the
  guitar keeps playing the last bar in time.
- **Strums:** a strum plucks one string per frame, 20 ms apart, low to high or high to low.
- **Quiet when idle:** 300 ms after a stop the sketch stops sending pulses, so the servos can't
  move between patterns.

## Commands

The sketch does nothing by itself. Everything is a Bridge call from the Linux side:

```python
from arduino.app_utils import App, Bridge
import time

def loop():
    Bridge.call("queue", "96;0:127,48:191", 90)  # down strum on beat 1, up strum on beat 3
    Bridge.call("start", 90)
    time.sleep(10)
    Bridge.call("stop")
    time.sleep(2)

App.run(user_loop=loop)
```

| Call | What it does | Returns |
|---|---|---|
| `queue(bar, bpm)` | Sets the bar to play next. Replaces any bar still waiting. `bpm` is used only when no knob is plugged in (0 = keep the current tempo) | `false` if the bar is malformed |
| `start(bpm)` | Plays the queued bar from its start and loops it. `bpm` 1 to 255; the knob wins if plugged in | `false` if nothing is queued or the tempo is 0 |
| `stop()` | Stops now | `true` |
| `seq()` | Sequencer state as text: `running bar bpm gesture_count last_gesture` | text |
| `play(steps)` | Plays a one-off list of steps, then replies. Not while a bar is playing | `false` if malformed or busy |
| `angles(string, a, b)` | Sets one string's rest angles (string 0 = low E) and moves the pick there | `false` if out of range |
| `reset()` | Moves every pick back to side A. Not while a bar is playing | `false` if busy |
| `show(name)` | Shows a chord name on the LED matrix. `""` shows `-` | `true` |
| `knob()` | Knob position 0 to 40 (multiply by 5 for BPM) | `-1` if no knob |
| `knob_click()` | Knob button since the last ask: `1` = press, `-1` = double tap, `0` = nothing | number |
| `stats()` | Debug text: `uptime_ms plays bars late_edges max_late_us` | text |

The sketch also sends notifications. Register a handler with `Bridge.provide(name, handler)`:

| Notification | When |
|---|---|
| `bar(bar_no, bpm)` | A bar starts. This is the cue to queue the next one |
| `stopped(0)` | The knob was turned to 0 and playing stopped |
| `knob_gesture(g)` | Knob button while playing: `1` = press, `-1` = double tap |

Don't call the board from inside a handler: it can deadlock the Bridge. Put the event on a queue
and act on it from another thread, as `strummer/player.py` does.

### Bar format

```
96;0:127,24:63,48:191
```

- **Before the `;`:** the bar's length in ticks. One tick is 1/24 of a beat, so a 4/4 bar is 96.
  The longest bar is 384 ticks.
- **After it:** events as `tick:mask`, in time order, at most 48. Rests are just gaps.
- **Mask:** which strings, as six bits (1 = low E, 2 = A, 4 = D, 8 = G, 16 = B, 32 = high e).
  Add 64 for a down strum (low to high) or 128 for an up strum. With neither, the strings are
  plucked together.

So the bar above is a down strum of all six strings on beat 1 (`63 + 64`), all six plucked
together on beat 2 (`63`), and an up strum on beat 3 (`63 + 128`).

### Steps format (for `play`)

```
1:300,2:300,63:500
```

Each step is `mask:ms`: pluck the strings in the mask (same six bits, no strum bits), then wait
that long. A mask of 0 is a rest. Times are rounded to 20 ms. Keep the whole text under 200
characters.

## Troubleshooting

- **Built-in LED blinks fast and nothing else happens:** the sketch's start-up timing check
  failed, so it refuses to send pulses. It expects the UNO Q's 160 MHz microcontroller clock.
- **Servos twitch or the board restarts when they move:** power. Check the servos are on their
  own supply and the grounds are joined. `stats()` showing an uptime near zero means the
  microcontroller just reset.
- **A pick misses its string or jams on it:** recalibrate that string's angles.
- **`stats()` shows late edges climbing:** something is delaying the pulse timing. A few are
  harmless; a steady climb shows up as twitching.
- **It won't compile because of `k_sched_lock`:** add `#define SERVO_SCHED_LOCK 0` above the
  includes in `sketch.ino`.

## Tests

```sh
scripts/test.sh
```

Runs the Python player against a fake board, and the sketch's sequencer on your PC (needs `g++`)
against the same expected timings as the Python side.

## Team

Built at DurHack 2026 by Jirawat Sukharom (hardware, Arduino), Shin Khant Soe Moe (hardware) and
Debanjan Ray (software).
