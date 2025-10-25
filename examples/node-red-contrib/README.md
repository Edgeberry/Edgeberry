![Edgeberry Banner](https://raw.githubusercontent.com/Edgeberry/.github/main/brand/Edgeberry_banner_SDK.png)

The **Edgeberry Node-RED node** lets your on-device Node-RED flows communicate with the Edgeberry Device Software over DBus to send telemetry data to the Device Hub.

[![Node-RED](https://img.shields.io/badge/Node--RED-Edgeberry-blue?logo=nodered)](https://flows.nodered.org/node/@edgeberry/device-node-red-contrib)
## Features

- **Send Telemetry Data** - Send sensor readings and device data to Device Hub  
- **Receive Cloud Messages** - Receive commands and data from cloud applications
- **Application Status** - Report application health and status  
- **Device Identification** - Trigger device's physical identification (LED blink + beep sound)
- **D-Bus Integration** - Direct communication with Edgeberry Device Software


## Installation

### Option 1: Install via Node-RED Palette Manager
1. Open Node-RED in your browser
2. Click the menu (☰) → Manage palette
3. Go to the Install tab
4. Search for `@edgeberry/device-node-red-contrib`
5. Click Install

### Option 2: Manual Install
On your Edgeberry device:
```bash
cd ~/.node-red
npm install @edgeberry/device-node-red-contrib
```

Restart Node-RED after installation.

## Quick Start

### Send Telemetry Data

1. Add an **Inject** node (trigger every 10 seconds)
2. Add a **Function** node with this code:
```javascript
msg.topic = "telemetry";
msg.payload = {
    temperature: 22.5,
    humidity: 45,
    status: "ok"
};
return msg;
```
3. Add an **Edgeberry** node
4. Connect: Inject → Function → Edgeberry
5. Deploy and watch the data flow to Device Hub!

### Receive Data on Device Hub

On your Device Hub server with Node-RED:
1. Install `@edgeberry/devicehub-node-red-contrib`
2. Add a **Device Hub Device** node
3. Configure it with your device name (e.g., EDGB-A096)
4. Connect it to a Debug or Dashboard node
5. You'll receive your telemetry data in real-time

### Receive Cloud-to-Device Messages

The Edgeberry node automatically receives messages from the cloud:

**Device Flow:**
```
[Edgeberry] → [Switch: topic=cloudMessage] → [Process Message]
```

**Switch Node Configuration:**
- Property: `msg.topic`
- Rule: `== cloudMessage`

**Cloud Flow (on Device Hub):**
```
[Inject] → [Function] → [Device Hub Device: EDGB-A096]
```

**Function Node:**
```javascript
msg.action = "sendMessage";
msg.payload = {
    command: "updateConfig",
    interval: 30
};
return msg;
```

The device will receive the message and output it with `topic: 'cloudMessage'`.

## License & Collaboration
**Copyright© 2025 Sanne 'SpuQ' Santens**. The Edgeberry NodeRED node is licensed under the **[MIT License](LICENSE.txt)**. The [Rules & Guidelines](https://github.com/Edgeberry/.github/blob/main/brand/Edgeberry_Trademark_Rules_and_Guidelines.md) apply to the usage of the Edgeberry™ brand.

### Collaboration

If you'd like to contribute to this project, please follow these guidelines:
1. Fork the repository and create your branch from `main`.
2. Make your changes and ensure they adhere to the project's coding style and conventions.
3. Test your changes thoroughly.
4. Ensure your commits are descriptive and well-documented.
5. Open a pull request, describing the changes you've made and the problem or feature they address.