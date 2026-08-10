"""
    edgeberry.py
    Core functionality for Edgeberry device.
"""

import json
import threading
from pydbus import SystemBus    # D-Bus System bus
from gi.repository import GLib  # Main loop, needed to receive D-Bus signals

# Edgeberry Core D-Bus
EDGEBERRY_SERVICE = "io.edgeberry.Core"
EDGEBERRY_OBJECT = "/io/edgeberry/Core"
EDGEBERRY_INTERFACE = "io.edgeberry.Core"

# The Core owns its bus name a moment before it has finished exporting the
# interface, so wait that moment out before talking to a freshly started one.
RESEND_DELAY_MS = 500


class Edgeberry:
    """
    Client for the Edgeberry Device Software D-Bus API.

    Signals are delivered on a GLib main loop. Unless `start_loop` is False,
    one is run on a background daemon thread so plain scripts receive signals
    without having to be restructured around GLib; handlers are then called on
    that thread. Applications that already run their own main loop should pass
    `start_loop=False` and let theirs do the dispatching.
    """

    def __init__(self, start_loop=True):
        # Always defined, so a failed connection surfaces as a clear message
        # from the method that needed it rather than an AttributeError.
        self.bus = None
        self.edgeberry_core_service = None
        self._start_loop = start_loop
        self._loop = None
        self._loop_thread = None
        # The last application info that was set. The Core keeps it in memory
        # only, so it forgets it when the service restarts; remembering it here
        # is what lets us tell the new instance again.
        self._last_info = None
        self._watching_restart = False
        try:
            # Connect to the D-Bus system bus
            self.bus = SystemBus()
            # Connect to the Edgeberry Core service
            self.edgeberry_core_service = self.bus.get(EDGEBERRY_SERVICE, EDGEBERRY_OBJECT)
            self._watch_for_restart()
        except Exception as e:
            print(f"Edgeberry: error connecting to Edgeberry D-Bus: {e}")

    """
        Application
    """

    # Set application info
    #
    # `routes` declares the views this application offers, which the device
    # interface builds its application menu from:
    #
    #     routes=[{"label": "Dashboard", "path": "/dashboard", "default": True,
    #              "icon": "gauge"},
    #             {"label": "Editor",    "path": "/editor", "target": "tab"},
    #             {"label": "Repository", "path": "https://github.com/...",
    #              "icon": "brands github"}]
    #
    # A 'path' is this application's own path; the device serves it under its
    # application prefix. An absolute http(s) URL points off the device and is
    # linked unchanged.
    #
    # 'target' is 'iframe' (shown inside the interface) or 'tab', defaulting to
    # 'iframe' for a path and 'tab' for a URL. The device settles on one default
    # route whether or not one is marked.
    #
    # 'icon' names a Font Awesome icon from the free set the device bundles. The
    # name alone is the solid style; name a style first ('brands github',
    # 'regular star') for the others, with the 'fa-' prefixes optional. Left out,
    # the item shows whether it opens in the interface or in a tab. An unusable
    # value is dropped with a logged reason and the route still works.
    def set_application_info(self, name, version, description, routes=None):
        try:
            application_info = {
                "name": name,
                "version": version,
                "description": description
            }
            if routes is not None:
                application_info["routes"] = routes

            # Remembered before the call, so info set while the Core is down is
            # still replayed once it comes up.
            self._last_info = application_info

            return self.edgeberry_core_service.SetApplicationInfo(json.dumps(application_info))

        except Exception as e:
            print(f"Edgeberry: error setting application info: {e}")
            return None

    def set_status(self, level, message):
        try:
            # Create dictionary
            status = {
                "level": level,
                "message": message
            }

            # Convert dictionary to JSON string
            status_json = json.dumps(status)

            # Call the 'SetApplicationStatus' method on the Edgeberry Core service object
            return self.edgeberry_core_service.SetApplicationStatus(status_json)
        except Exception as e:
            # Print the error message
            print(f"Edgeberry: error setting status: {e}")
            return None

    # Send a telemetry message to the Device Hub
    def send_message(self, message):
        try:
            # The Core takes the message as a JSON string; anything
            # json.dumps can serialise is accepted.
            return self.edgeberry_core_service.SendMessage(json.dumps(message))
        except Exception as e:
            # Print the error message
            print(f"Edgeberry: error sending message: {e}")
            return None

    # Trigger the on-device identification routine (LED blink + beep)
    def identify(self):
        try:
            return self.edgeberry_core_service.Identify()
        except Exception as e:
            # Print the error message
            print(f"Edgeberry: error identifying device: {e}")
            return None

    # Get the device state as a dictionary
    def get_state(self):
        try:
            raw = self.edgeberry_core_service.GetState()
            if not raw:
                return None
            return json.loads(raw)
        except Exception as e:
            # Print the error message
            print(f"Edgeberry: error getting device state: {e}")
            return None

    """
        Signals
        Each subscription returns a function that removes the handler again.
    """

    # Cloud-to-device messages
    def on_cloud_message(self, handler):
        return self._subscribe_json("CloudMessage", handler)

    # Hardware button events: click | pressrelease | apToggle | longpress | verylongpress
    def on_button_event(self, handler):
        return self._subscribe_json("ButtonEvent", handler)

    # Full device state, emitted on every change
    def on_state(self, handler):
        return self._subscribe_json("StateUpdate", handler)

    """
        Housekeeping
    """

    # Stop the background main loop. Safe to call more than once.
    def close(self):
        if self._loop is not None:
            try:
                self._loop.quit()
            except Exception:
                pass
        self._loop = None
        self._loop_thread = None
        self._last_info = None

    """
        Internals
    """

    # Subscribe to a signal whose payload is a single JSON-encoded string.
    # Falls back to the raw string when it does not parse.
    def _subscribe_json(self, signal_name, handler):
        try:
            signal = getattr(self.edgeberry_core_service, signal_name)
        except Exception as e:
            print(f"Edgeberry: error subscribing to {signal_name}: {e}")
            return lambda: None

        def listener(*args):
            # pydbus hands the signal arguments through; the Core sends one
            # string. Take the last argument so this holds whether or not the
            # sender/path preamble is included.
            raw = args[-1] if args else None
            if isinstance(raw, (list, tuple)):
                raw = raw[0] if raw else None
            try:
                handler(json.loads(raw))
            except (TypeError, ValueError):
                handler(raw)

        subscription = signal.connect(listener)
        self._ensure_loop()

        def unsubscribe():
            try:
                subscription.disconnect()
            except Exception:
                pass

        return unsubscribe

    # Re-send the remembered application info whenever the Core claims its bus
    # name again, which is what a restart looks like from here.
    def _watch_for_restart(self):
        if self._watching_restart:
            return
        try:
            dbus_obj = self.bus.get("org.freedesktop.DBus", "/org/freedesktop/DBus")
            dbus_obj.NameOwnerChanged.connect(self._on_name_owner_changed)
            self._watching_restart = True
            self._ensure_loop()
        except Exception as e:
            # Without the watcher everything else still works; info just is not replayed.
            print(f"Edgeberry: could not watch for Core restarts: {e}")

    def _on_name_owner_changed(self, name, old_owner, new_owner):
        # An empty new_owner is the name being released — the Core going away.
        # Only its arrival is interesting.
        if name != EDGEBERRY_SERVICE or not new_owner:
            return
        GLib.timeout_add(RESEND_DELAY_MS, self._resend_application_info)

    def _resend_application_info(self):
        if self._last_info is not None:
            try:
                self.edgeberry_core_service.SetApplicationInfo(json.dumps(self._last_info))
            except Exception as e:
                # Not the caller's problem — they never asked for this call.
                print(f"Edgeberry: could not resend application info: {e}")
        return False    # one shot, do not repeat

    # Run a GLib main loop on a background thread so signals are dispatched
    # without the application having to own one.
    def _ensure_loop(self):
        if not self._start_loop or self._loop is not None:
            return
        self._loop = GLib.MainLoop()
        self._loop_thread = threading.Thread(target=self._loop.run, daemon=True)
        self._loop_thread.start()
