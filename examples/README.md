# Edgeberry Device Software Examples

This directory contains example integrations and tools for the Edgeberry Device Software.

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

> **Important:** The version number of `node-red-contrib-edgeberry` is kept in sync with the Edgeberry Device Software version to ensure compatibility. When releasing a new version of the device software, update `examples/node-red-contrib/package.json` accordingly.

## Versioning Policy

The `node-red-contrib-edgeberry` package version **must stay in sync** with the Edgeberry Device Software version (root `package.json`).

**When releasing device software:**
1. Update version in root `package.json`
2. Update version in `examples/node-red-contrib/package.json` to match
3. Tag release: `git tag node-red-v3.1.0` (triggers npm publish)

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
