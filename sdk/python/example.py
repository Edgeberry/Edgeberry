import time

from edgeberry import Edgeberry


def main():
    edgeberry = Edgeberry()

    # Told once — the SDK sends it again by itself if the Edgeberry Device
    # Software restarts underneath us.
    edgeberry.set_application_info("example", "v3.8.0", "Edgeberry application example")
    edgeberry.set_status("ok", "running")

    state = edgeberry.get_state()
    if state:
        print("device software version:", state["system"]["version"])

    edgeberry.on_cloud_message(lambda payload: print("cloud message:", payload))
    edgeberry.on_button_event(lambda event: print("button:", event.get("event")))

    edgeberry.send_message({"example": "hello from python"})

    # Signals are delivered on the SDK's background main loop, so the program
    # only has to stay alive to receive them.
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        edgeberry.close()


if __name__ == "__main__":
    main()
