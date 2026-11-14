import threading

from arduino.app_utils import App, Bridge
from arduino.app_bricks.web_ui import WebUI

ui = WebUI()
busy = threading.Lock()


def strum():
    # One strum at a time: a second message arriving mid-pulse could be garbled on the MCU.
    if not busy.acquire(blocking=False):
        return {"ok": False, "busy": True}
    try:
        Bridge.call("strum")
        return {"ok": True}
    finally:
        busy.release()


ui.expose_api("POST", "/strum", strum)

App.run()
