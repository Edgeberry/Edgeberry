![Edgeberry Banner](https://raw.githubusercontent.com/Edgeberry/.github/main/brand/Edgeberry_banner_SDK.png)

# @edgeberry/device-sdk

Node.js SDK for interfacing applications with the [Edgeberry Device Software](https://github.com/Edgeberry/Edgeberry-device-software) over D-Bus. Provides a small, typed API for sending telemetry, publishing application info/status, triggering device identification, and subscribing to cloud-to-device messages.

This is the Node counterpart to the Python [`edgeberry`](../python-sdk) SDK, and is the same client used by the [`@edgeberry/device-node-red-contrib`](../node-red-contrib) Node-RED node.

## Installation

```bash
npm install @edgeberry/device-sdk
```

The SDK talks to the `io.edgeberry.Core` service on the D-Bus **system bus**, which is where the Edgeberry Device Software registers itself. It is intended to run on the same host as the Edgeberry Device Software.

## Quick start

```ts
import { Edgeberry } from '@edgeberry/device-sdk';

const edge = new Edgeberry();

await edge.setApplicationInfo({
  name: 'my-app',
  version: '1.0.0',
  description: 'My Edgeberry application',
});

await edge.setApplicationStatus({ level: 'ok', message: 'Running fine' });

await edge.sendMessage({ temperature: 22.5, humidity: 45 });

await edge.onCloudMessage((payload) => {
  console.log('Cloud says:', payload);
});
```

CommonJS is fully supported:

```js
const { Edgeberry } = require('@edgeberry/device-sdk');
const edge = new Edgeberry();
```

## API

### `new Edgeberry(options?)`

Creates a client. The D-Bus connection is opened lazily on the first call.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `bus`  | `'system' \| 'session'` | `'system'` | Which D-Bus to connect to. Use `'session'` only for local testing. |

### `identify(): Promise<void>`

Triggers the on-device physical identification routine (LED blink + beep).

### `setApplicationInfo(info): Promise<string>`

Publishes application metadata to the Device Hub.

```ts
await edge.setApplicationInfo({ name, version, description });
```

Returns the Core service's raw response string (`'ok'` on success).

### `setApplicationStatus(status): Promise<string>`

Publishes an application health/status update. Accepts either an object or positional args (for parity with the Python SDK):

```ts
await edge.setApplicationStatus({ level: 'ok', message: 'All good' });
await edge.setApplicationStatus('warning', 'Sensor reading noisy');
```

### `sendMessage(data): Promise<string>`

Sends telemetry / a cloud-bound message. Returns the raw response string from the Core service:

| Response | Meaning |
|----------|---------|
| `'ok'` | Sent |
| `'err:not_initialized'` | Device Hub client is not initialized yet |
| `'err:not_connected'` | Device Hub is unreachable |
| `'err:invalid_data'` | Payload could not be serialized |

### `onCloudMessage(handler): Promise<() => void>`

Subscribes to the `CloudMessage` D-Bus signal (messages coming from the cloud to this device). The JSON payload is parsed before being handed to the handler. Returns an unsubscribe function.

```ts
const unsubscribe = await edge.onCloudMessage((payload) => {
  console.log('Cloud message:', payload);
});

// later
unsubscribe();
```

### `onButtonEvent(handler): Promise<() => void>`

Subscribes to hardware button events emitted by the device. The handler receives `{ event, timestamp }`, where `event` is one of:

| Event | Duration | Notes |
|-------|----------|-------|
| `click` | < ~1.7&nbsp;s | short press |
| `pressrelease` | ~1.7&nbsp;s - 2.5&nbsp;s | long press |
| `apToggle` | ~3&nbsp;s | toggles WiFi provisioning AP mode |
| `longpress` | 5&nbsp;s+ | triggers a device restart |
| `verylongpress` | 10&nbsp;s+ | reserved for factory reset |

```ts
const unsubscribe = await edge.onButtonEvent(({ event, timestamp }) => {
  if (event === 'click') console.log('button clicked at', timestamp);
});
```

### `onState(handler): Promise<() => void>`

Subscribes to device state updates (`system` / `connection` / `application` sections). Fires whenever any part of the state changes.

```ts
await edge.onState((state) => {
  console.log('wifi:', state.connection.wifi, 'cloud:', state.connection.connection);
});
```

### `getState(): Promise<DeviceState>`

Fetch the current device state on demand, without waiting for the next `StateUpdate` signal.

```ts
const state = await edge.getState();
console.log(state.system.state, state.system.version);
```

### `close(): void`

Releases the underlying D-Bus connection. Safe to call multiple times.

## D-Bus surface

The SDK is a thin wrapper over the following D-Bus surface exposed by the Edgeberry Device Software:

- **Service:** `io.edgeberry.Core`
- **Object path:** `/io/edgeberry/Core`
- **Interface:** `io.edgeberry.Core`
- **Methods:** `Identify()`, `SetApplicationInfo(s) -> s`, `SetApplicationStatus(s) -> s`, `SendMessage(s) -> s`, `GetState() -> s`
- **Signals:** `CloudMessage(s)`, `ButtonEvent(s)`, `StateUpdate(s)`

You can inspect it directly with `dbus-send` / `busctl` for debugging.

## Version compatibility

The SDK version tracks the Edgeberry Device Software version. Use the SDK version that matches the device software running on your device.

## License

MIT © Sanne 'SpuQ' Santens. The [Rules & Guidelines](https://github.com/Edgeberry/.github/blob/main/brand/Edgeberry_Trademark_Rules_and_Guidelines.md) apply to the usage of the Edgeberry&trade; brand.
