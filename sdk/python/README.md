![Edgeberry Banner](https://raw.githubusercontent.com/Edgeberry/.github/main/brand/Edgeberry_banner_SDK.png)

<img src="https://s3.dualstack.us-east-2.amazonaws.com/pythondotorg-assets/media/community/logos/python-logo-only.png" align="right" width="10%"/>

The **Edgeberry Python SDK** is a software library to facilitate communication between Python application and the **Edgeberry Device Software**. The Edgeberry Python SDK interacts with the Edgeberry Device Software throught the D-Bus API.

<br clear="right"/>

## Usage
The SDK talks to D-Bus through `pydbus` and `PyGObject`. Install those from the
system package manager rather than letting `pip` build them — PyGObject compiles
against the gobject-introspection headers and rarely builds cleanly on a device.
```shell
sudo apt install -y python3-pydbus python3-gi
pip install edgeberry
```
After installation, the `edgeberry` library can be used as follows
```python
# Import the library in your application
from edgeberry import Edgeberry

# Create the Edgeberry object
edgeberry = Edgeberry()

# Application
edgeberry.set_application_info("name", "version", "description")    # Called when the program (re)starts
edgeberry.set_status("level", "message")                            # Level can be ok|warning|error|critical|emergency
edgeberry.send_message({"temperature": 21.5})                       # Telemetry to the Device Hub

# Device
edgeberry.identify()                                                # Blink the LED and beep
state = edgeberry.get_state()                                       # Device state as a dictionary

# Signals. Each subscription returns a function that removes the handler again.
unsubscribe = edgeberry.on_state(lambda state: print(state))
edgeberry.on_cloud_message(lambda payload: print(payload))          # Cloud-to-device messages
edgeberry.on_button_event(lambda event: print(event["event"]))      # click | pressrelease | apToggle | longpress | verylongpress
unsubscribe()
```

The application info you set is remembered. When the Edgeberry Device Software
restarts it loses what applications told it, so the SDK sends the info again as
soon as the service is back — an application only has to call
`set_application_info()` once.

### Main loop
Signals arrive on a GLib main loop. The SDK runs one on a background daemon
thread so plain scripts receive signals without being restructured, which means
handlers are called on that thread. If your application already runs its own
main loop, construct with `Edgeberry(start_loop=False)` and let yours do the
dispatching. Call `edgeberry.close()` to stop the SDK's loop.

## License & Collaboration
**Copyright© 2024 Sanne 'SpuQ' Santens**. The Edgeberry Python SDK is licensed under the **[MIT License](LICENSE.txt)**. The [Rules & Guidelines](https://github.com/Edgeberry/.github/blob/main/brand/Edgeberry_Trademark_Rules_and_Guidelines.md) apply to the usage of the Edgeberry™ brand.

### Collaboration

If you'd like to contribute to this project, please follow these guidelines:
1. Fork the repository and create your branch from `main`.
2. Make your changes and ensure they adhere to the project's coding style and conventions.
3. Test your changes thoroughly.
4. Ensure your commits are descriptive and well-documented.
5. Open a pull request, describing the changes you've made and the problem or feature they address.