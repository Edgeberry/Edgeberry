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

## Node-RED Contribution (`node-red-contrib`)

Node-RED node for interacting with Edgeberry Device Software via D-Bus. Enables sending telemetry data, managing device state, and handling cloud connectivity from Node-RED flows running on Edgeberry devices.

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
- [EXAMPLES.md](./node-red-contrib/EXAMPLES.md) - Detailed usage examples

**Version:** 3.1.0 (synced with device software)

> **Important:** The version number of `@edgeberry/device-node-red-contrib` is kept in sync with the Edgeberry Device Software version to ensure compatibility. When releasing a new version of the device software, update `examples/node-red-contrib/package.json` accordingly.

## Versioning Policy

All example packages (Python SDK, Node-RED contrib) **must stay in sync** with the Edgeberry Device Software version (root `package.json`).

**When releasing device software:**
1. Update version in root `package.json`
2. Update version in `examples/python-sdk/setup.py` to match
3. Update version in `examples/node-red-contrib/package.json` to match
4. Tag releases:
   - Python: `git tag python-v3.1.0` (triggers PyPI publish)
   - Node-RED: `git tag node-red-v3.1.0` (triggers npm publish)

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
