# Edgeberry Device Software Examples

This directory contains example integrations and tools for the Edgeberry Device Software.

## Python SDK (`python-sdk`)

Python SDK for interfacing applications with Edgeberry Device Software via D-Bus. Provides a simple Pythonic API for sending telemetry, managing application state, and interacting with the device.

**Features:**
- Send telemetry data to Device Hub
- Update application info and status
- Trigger device identification
- Simple Python interface over D-Bus

**Installation:**
```bash
pip install edgeberry
```

**Usage:**
```python
from edgeberry import Edgeberry

edge = Edgeberry()
edge.send_message({"temperature": 25.0, "humidity": 60})
edge.set_application_info("MyApp", "1.0.0", "My application")
```

**Documentation:**
- [README.md](./python-sdk/README.md) - API reference and examples
- [example.py](./python-sdk/example.py) - Complete usage example

**Version:** 3.1.0 (synced with device software)

## Node SDK (`node-sdk`)

Node.js SDK for interfacing applications with Edgeberry Device Software via D-Bus. Provides a small, typed API that mirrors the Python SDK. This is the client used internally by the Node-RED node.

**Features:**
- Send telemetry data to Device Hub
- Update application info and status
- Trigger device identification
- Subscribe to cloud-to-device messages
- TypeScript type definitions included

**Installation:**
```bash
npm install @edgeberry/device-sdk
```

**Usage:**
```ts
import { Edgeberry } from '@edgeberry/device-sdk';

const edge = new Edgeberry();
await edge.setApplicationInfo({ name: 'MyApp', version: '1.0.0', description: 'My application' });
await edge.sendMessage({ temperature: 25.0, humidity: 60 });
```

**Documentation:**
- [README.md](./node-sdk/README.md) - API reference
- [example.ts](./node-sdk/example.ts) - Complete usage example

**Version:** 3.3.3 (synced with device software)

## Node-RED Contribution (`node-red-contrib`)

Node-RED node for interacting with Edgeberry Device Software. Enables sending telemetry data, managing device state, and handling cloud connectivity from Node-RED flows running on Edgeberry devices. Wraps `@edgeberry/device-sdk` behind a drag-and-drop node.

**Features:**
- Send telemetry data to Device Hub
- Update application info and status
- Trigger device identification
- Simple drag-and-drop integration

**Installation:**
```bash
# From device with Node-RED installed
cd ~/.node-red
npm install /path/to/Edgeberry-device-software/examples/node-red-contrib
node-red-restart
```

**Documentation:**
- [README.md](./node-red-contrib/README.md) - Quick start guide

**Version:** 3.3.3 (synced with device software)

> **Important:** The version numbers of `@edgeberry/device-sdk` and `@edgeberry/device-node-red-contrib` are kept in sync with the Edgeberry Device Software version to ensure compatibility. When releasing a new version of the device software, update the version fields in `examples/node-sdk/package.json` and `examples/node-red-contrib/package.json` accordingly.

## Versioning Policy

All example packages (Python SDK, Node SDK, Node-RED contrib) **must stay in sync** with the Edgeberry Device Software version (root `package.json`).

**When releasing device software:**
1. Update version in root `package.json`
2. Update version in `examples/python-sdk/setup.py` to match
3. Update version in `examples/node-sdk/package.json` to match
4. Update version in `examples/node-red-contrib/package.json` to match (and its `@edgeberry/device-sdk` dep)
5. Tag releases:
   - Python: `git tag python-v3.3.3` (triggers PyPI publish)
   - Node SDK: `git tag node-sdk-v3.3.3` (triggers npm publish)
   - Node-RED: `git tag node-red-v3.3.3` (triggers npm publish)

## Publishing

Publishing to npm happens automatically via GitHub Actions when you push a tag:
```bash
cd examples/node-red-contrib
git tag node-red-v3.1.0
git push origin node-red-v3.1.0
```

Or manually:
```bash
cd examples/node-red-contrib
npm publish
```

## Future Examples

This directory may include additional examples such as:
- Python SDK integration examples
- Virtual device simulators
- Custom application integrations
