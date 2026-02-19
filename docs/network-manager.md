# Network Manager — WiFi Provisioning over D-Bus

## Overview

`src/network.manager.ts` provides a class-based interface to NetworkManager over D-Bus (`org.freedesktop.NetworkManager`) for WiFi provisioning on the Edgeberry device. It enables the device to act as a WiFi access point so users can connect and configure WiFi credentials via a captive portal.

## Provisioning Flow

Two triggers lead to AP (Access Point) mode:

1. **On boot:** no saved WiFi connection exists in NetworkManager → enter AP mode automatically
2. **On user request:** physical button held for ~3 seconds → enter AP mode

Once the user selects a network and provides credentials through the captive portal UI, the device connects to that network and tears down the AP.

### Boot Sequence

The startup sequence in `main.ts` follows this order:

1. Initialize system state (platform, board info, UUID, version)
2. Board ID / client ID consistency check
3. **WiFi check** — `networkManager.hasSavedWifiConnection()`
   - **No saved WiFi:** call `enterApMode()` → LED shows orange triple-burst → device stays in AP mode awaiting captive portal configuration. Device Hub connection is **not** attempted.
   - **Saved WiFi exists:** proceed to `connectToDeviceHub()` (existing Device Hub / MQTT provisioning flow).
4. After successful captive portal configuration → `handleWifiProvisioned(ssid, passphrase)` stops the AP and continues to Device Hub.

### Button AP Toggle

A ~3-second button press (2.5 s – 5 s) emits `apToggle` on `system_button`:

- **Not in AP mode →** disconnect WiFi → `enterApMode()`
- **In AP mode →** attempt `exitApMode()`:
  - If a saved WiFi connection exists: stop AP → reconnect → resume Device Hub flow
  - If no saved WiFi: error indication (fast red LED flash + 3 beeps), remain in AP mode

Existing button thresholds (no conflicts):

| Duration | Event | Action |
|---|---|---|
| < 1.7 s | `click` | Short beep |
| 1.7 – 2.5 s | `pressrelease` | (User API event) |
| **2.5 – 5 s** | **`apToggle`** | **Toggle AP mode** |
| 5 – 10 s | `longpress` | System restart |
| ≥ 10 s | `verylongpress` | Factory reset (TODO) |

## Module Design

- **File:** `src/network.manager.ts`
- **Export:** `NetworkManager` class (extends `EventEmitter`)
- **Export:** `AccessPointInfo` type
- **D-Bus library:** `dbus-native` (existing project dependency)
- **Bus:** system bus (`dbus.systemBus()`)

The class wraps all NetworkManager D-Bus interactions behind async methods, using Promises over the underlying callback-based `dbus-native` API. Three private helpers (`getInterface`, `getProperty`, `getAllProperties`) encapsulate common D-Bus patterns.

## Integration Points

### main.ts exports

| Export | Type | Description |
|---|---|---|
| `networkManager` | `NetworkManager` | Shared instance used throughout the application |
| `handleWifiProvisioned(ssid, passphrase)` | `async (string, string) => boolean` | Called by captive portal after user submits credentials |

### state.manager.ts — `connection.wifi` field

New field on the `connection` state object:

| Value | Meaning |
|---|---|
| `ap_mode` | Device is running as an Access Point |
| `connected` | WiFi connected after captive portal provisioning |
| `disconnected` | WiFi disconnected / AP stopped |
| `unknown` | Initial state |

### LED States

| State | Pattern | Trigger |
|---|---|---|
| **AP mode** | 3× orange burst (90 ms on/off × 3, 1.8 s interval) | `connection.wifi === 'ap_mode'` |
| **AP error** | Fast red flash (60 ms) + 3 beeps | `interruptIndicators('ap_error')` — reverts after 1 s |

AP mode LED priority is above cloud connection status but below system status (updating, rebooting, etc.).

## NetworkManager Public API

### Saved Connections

| Method | Returns | Description |
|---|---|---|
| `listSavedWifiConnections()` | `Promise<string[]>` | List D-Bus paths of saved WiFi connections (filtered by `connection.type === '802-11-wireless'`) |
| `hasSavedWifiConnection()` | `Promise<boolean>` | Check if any saved WiFi connection exists (for the boot check) |
| `deleteConnection(connectionPath)` | `Promise<void>` | Delete a saved connection by its D-Bus path |

### WiFi Device & Scanning

| Method | Returns | Description |
|---|---|---|
| `getWifiDevicePath()` | `Promise<string>` | Get the D-Bus path of the WiFi device (`DeviceType === 2`). Caches the result. |
| `requestScan()` | `Promise<void>` | Trigger a WiFi scan via `RequestScan` |
| `getAccessPoints()` | `Promise<AccessPointInfo[]>` | Read discovered APs. Deduplicates by SSID (keeping strongest signal), sorts by strength descending, skips hidden networks. |

`AccessPointInfo` fields: `ssid`, `strength`, `frequency`, `secured`.

Security is derived from AP `Flags` (privacy bit), `WpaFlags`, and `RsnFlags`.

### Access Point Mode

| Method | Returns | Description |
|---|---|---|
| `startAccessPoint(hardwareUUID)` | `Promise<void>` | Start an open AP. SSID: `EDGB-XXXXXX` (first 6 hex chars of UUID). Uses `mode: ap`, `band: bg`, `ipv4.method: shared`, `autoconnect: false`. |
| `stopAccessPoint()` | `Promise<void>` | Deactivate the AP connection and delete the temporary connection profile. |
| `isAccessPointActive()` | `Promise<boolean>` | Check if the AP is currently active (active connection state === `Activated`). |

The hardware UUID is passed in by the caller (read from EEPROM via `system_board_getUUID()`).

### WiFi Connection

| Method | Returns | Description |
|---|---|---|
| `connectToNetwork(ssid, passphrase, timeoutMs?)` | `Promise<boolean>` | Connect using WPA-PSK with `autoconnect: true`. Polls active connection state until `Activated` (state 2) or `Deactivated` (state ≥ 4). Default timeout: 30 s. Cleans up the saved profile on failure. |
| `disconnect()` | `Promise<void>` | Disconnect the WiFi device. |

### State Monitoring

| Method | Returns | Description |
|---|---|---|
| `subscribeToStateChanges()` | `Promise<void>` | Subscribe to the WiFi device's `StateChanged` D-Bus signal. |

After calling `subscribeToStateChanges()`, the instance emits `'stateChanged'` events:

```typescript
networkManager.on('stateChanged', (newState: number, oldState: number) => {
    // handle state transition
});
```

## D-Bus Interfaces Used

| Interface | Object Path | Methods / Properties |
|---|---|---|
| `org.freedesktop.NetworkManager` | `/org/freedesktop/NetworkManager` | `GetDevices`, `AddAndActivateConnection`, `DeactivateConnection` |
| `org.freedesktop.NetworkManager.Settings` | `/org/freedesktop/NetworkManager/Settings` | `ListConnections` |
| `org.freedesktop.NetworkManager.Settings.Connection` | per connection path | `GetSettings`, `Delete` |
| `org.freedesktop.NetworkManager.Device` | per device path | `DeviceType` (prop), `Disconnect`, `StateChanged` (signal) |
| `org.freedesktop.NetworkManager.Device.Wireless` | WiFi device path | `RequestScan`, `GetAccessPoints` |
| `org.freedesktop.NetworkManager.AccessPoint` | per AP path | `Ssid`, `Strength`, `Frequency`, `Flags`, `WpaFlags`, `RsnFlags` (props) |
| `org.freedesktop.NetworkManager.Connection.Active` | per active conn path | `State` (prop) |
| `org.freedesktop.DBus.Properties` | any path | `Get`, `GetAll` |

## Usage Example

```typescript
import { NetworkManager } from './network.manager';
import { system_board_getUUID } from './system.service';

const nm = new NetworkManager();

// Boot check: enter AP mode if no WiFi is saved
const hasSaved = await nm.hasSavedWifiConnection();
if (!hasSaved) {
    const uuid = system_board_getUUID();
    if (uuid) await nm.startAccessPoint(uuid);
}

// Subscribe to state changes
await nm.subscribeToStateChanges();
nm.on('stateChanged', (newState, oldState) => {
    console.log('WiFi state: ' + oldState + ' → ' + newState);
});

// Scan and list networks
await nm.requestScan();
const networks = await nm.getAccessPoints();

// Connect to a network, then tear down AP
const success = await nm.connectToNetwork('MyNetwork', 'mypassword');
if (success) {
    await nm.stopAccessPoint();
}
```

## Connection Settings Wire Format

`AddAndActivateConnection` expects `a{sa{sv}}` (dict of string → dict of string → variant). In `dbus-native`, this is represented as nested arrays:

```javascript
[
    ['connection', [
        ['type',        ['s', '802-11-wireless']],
        ['autoconnect', ['b', true]]
    ]],
    ['802-11-wireless', [
        ['ssid', ['ay', [...Buffer.from('MySSID')]]],
        ['mode', ['s', 'infrastructure']]
    ]],
    ['802-11-wireless-security', [
        ['key-mgmt', ['s', 'wpa-psk']],
        ['psk',      ['s', 'passphrase']]
    ]],
    ['ipv4', [
        ['method', ['s', 'auto']]
    ]]
]
```
