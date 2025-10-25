![Edgeberry Banner](https://raw.githubusercontent.com/Edgeberry/.github/main/brand/Edgeberry_banner_device_software.png)

The **Edgeberry Device Software** turns a Linux device (e.g., Raspberry Pi) into a managed IoT device. It provisions the device to the Edgeberry cloud (AWS IoT Core), maintains a secure MQTT connection, and publishes device state. Designed for the Edgeberry Baseboard, it reads the HAT EEPROM to identify the board/UUID, drives the baseboard’s status LED and buzzer, and listens to the user button for actions like identify and link‑to‑user. On‑device it runs as a systemd service with a CLI (`edgeberry`) and a D‑Bus API for apps, providing secure fleet onboarding (X.509, fleet provisioning), consistent shadow/state management, and remote operations (reboot, update, reconnect) so you can fully focus on the application logic of your IoT device.

#### Key features
- Edgeberry Dashboard integration: secure provisioning (X.509, fleet provisioning), persistent MQTT, and device shadow sync, ...
- Remote control from the cloud: reboot, update, reconnect, and link‑to‑user via direct methods.
- Integration with the Edgeberry device hardware: EEPROM identity, status LED & buzzer patterns, user button actions, ...
- Runs as a `systemd` service with a simple CLI (`edgeberry`) and a D‑Bus API (`io.edgeberry.Core`) for local apps.
- Network/platform detection and safe persistence of settings and certificates.

## Installation
On your device, install the Edgeberry Device Software by downloading and executing the installation script
```
wget -O install.sh https://github.com/Edgeberry/Edgeberry/releases/latest/download/install.sh;
chmod +x ./install.sh;
sudo ./install.sh -y;
```
If the installation was successful, you can access the Edgeberry Commandline Interface (CLI):
```
$ sudo edgeberry --help
```

### Node-RED
Edgeberry provides a Node-RED node to interact with the Edgeberry Device Software over D-Bus. [Install Node-RED](https://nodered.org/docs/getting-started/raspberrypi) and the [Edgeberry node](https://flows.nodered.org/node/@edgeberry/device-node-red-contrib).

> [!TIP]
> During the installation Node-RED, do install the **Raspberry Pi specific nodes**.


## CLI
You can interact with the Edgeberry Device Software using the **Edgeberry CLI**.
```
sudo edgeberry --help
```

## Application development
### Python SDK
Edgeberry provides a SDK for Python applications
```bash
pip install edgeberry
```
See [examples/python-sdk](examples/python-sdk) for detailed documentation, API reference, and usage examples.

### D-Bus API
Edgeberry uses inter-process communication through `D-Bus` to interact with other applications. If there's no SDK available in your favorite language 
you can use D-Bus directly.

**Methods:**

| Object           | Method              | Argument                                                    | 
|------------------|---------------------|-------------------------------------------------------------|
|io.edgeberry.Core |SendMessage          | {"temperature":22.5,...} (any JSON telemetry data)         |
|                  |SetApplicationInfo   | {"name":[string],"version":[string],"description":[string]} |
|                  |SetApplicationStatus | {"status":[ok/warning/error/critical],"message":[string]}   |

**Signals:**

| Object           | Signal              | Payload                                                      | 
|------------------|---------------------|--------------------------------------------------------------|
|io.edgeberry.Core |CloudMessage         | JSON string with cloud-to-device message data                |

Using `dbus-send`, you can request a description (introspection) of the available methods, properties, and signals on the io.edgeberry.Core object. 
```sh
dbus-send --system --type=method_call --print-reply \
          --dest=io.edgeberry.Core \
          /io/edgeberry/Core \
          org.freedesktop.DBus.Introspectable.Introspect
```

### Node-RED Integration
For Node-RED users, install the Edgeberry node to send telemetry and interact with device software:
```bash
cd ~/.node-red
npm install /path/to/Edgeberry-device-software/examples/node-red-contrib
node-red-restart
```
See [examples/node-red-contrib](examples/node-red-contrib) for detailed documentation and usage examples.

## License & Collaboration
**Copyright© 2024 Sanne 'SpuQ' Santens**. The Edgeberry Device Software is licensed under the **[GNU GPLv3](LICENSE.txt)**. The [Rules & Guidelines](https://github.com/Edgeberry/.github/blob/main/brand/Edgeberry_Trademark_Rules_and_Guidelines.md) apply to the usage of the Edgeberry™ brand.

### Collaboration

If you'd like to contribute to this project, please follow these guidelines:
1. Fork the repository and create your branch from `main`.
2. Make your changes and ensure they adhere to the project's coding style and conventions.
3. Test your changes thoroughly.
4. Ensure your commits are descriptive and well-documented.
5. Open a pull request, describing the changes you've made and the problem or feature they address.