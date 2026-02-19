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
  - If a saved WiFi connection exists: stop AP → wait for hardware transition → activate saved connection → cloud reconnects automatically → beep
  - If no saved WiFi: error indication (fast red LED flash + 3 beeps), remain in AP mode

### Exit AP Mode Reconnection Flow

When exiting AP mode with a saved WiFi connection available, `exitApMode()` performs:

1. **Stop AP** — `networkManager.stopAccessPoint()` tears down the AP connection profile
2. **Hardware transition delay** — 2-second wait for the WiFi chip to switch from AP back to station mode
3. **Activate saved connection** — `networkManager.activateSavedWifiConnection()` uses `ActivateConnection` (not `AddAndActivateConnection`) to reactivate the first saved WiFi profile, polling until the connection reaches `Activated` state or times out (30 s)
4. **Cloud reconnection** — `connectToDeviceHub()` is called; if the cloud client already exists, it triggers `client.reconnect()` on the underlying MQTT client instead of creating a new one (see Cloud Reconnection below)
5. **Beep** — a single short beep confirms successful Device Hub reconnection

### Cloud Reconnection After AP Mode

The `EdgeberryDeviceHubClient` library has a `scheduleReconnect()` method that creates a **new** `mqtt.connect()` client on every `'close'` event without ending the previous one. Two MQTT clients with the same `clientId` cause the broker to kick one off repeatedly, creating an infinite connect/disconnect cycle.

To prevent this:
- `scheduleReconnect` is disabled on the cloud client instance after creation
- When `connectToDeviceHub()` is called with an existing cloud client, it calls `(cloud as any).client.reconnect()` (MQTT.js built-in reconnect) instead of `cloud.connect()` which would create a duplicate client
- State updates to cloud (`cloud.updateState()`) are guarded to only send when the connection state is `'connected'`, preventing feedback loops on a disconnected client

Existing button thresholds (no conflicts):

| Duration | Event | Action |
|---|---|---|
| < 1.7 s | `click` | Short beep |
| 1.7 – 2.5 s | `pressrelease` | (User API event) |
| **2.5 – 5 s** | **`apToggle`** | **Toggle AP mode** |
| 5 – 10 s | `longpress` | System restart |
| ≥ 10 s | `verylongpress` | Factory reset (TODO) |

## Captive Portal

### Overview

`src/captivePortal.ts` serves a WiFi provisioning web UI on port 80 when the device is in Access Point mode. Connected clients (phones, laptops) are automatically redirected to the provisioning wizard via standard captive portal detection.

### Architecture

- **File:** `src/captivePortal.ts`
- **Export:** `CaptivePortal` class
- **Dependency:** `express` (HTTP server), `NetworkManager` instance (for scanning and connecting)
- **Port:** 80 (requires root — the service runs as root via systemd)

### Lifecycle

```
AP activates → captivePortal.start(onConnected) → user configures WiFi
→ connection succeeds → brief success message → stop() → onConnected fires
→ caller tears down AP and resumes normal operation
```

The portal does **not** manage AP teardown or Device Hub logic itself. The `onConnected` callback is provided by the caller (`enterApMode()` in `main.ts`), which calls `exitApMode()` to handle the full teardown and reconnection sequence.

### API Routes

| Route | Method | Description |
|---|---|---|
| `/` | GET | Serve the self-contained provisioning wizard (inline CSS + JS) |
| `/api/networks` | GET | Trigger a WiFi scan, wait 2 s, return discovered networks as JSON |
| `/api/connect` | POST | Accept `{ssid, passphrase}`, connect via `connectToNetwork()`, return `{success}` |
| `*` (catch-all) | ALL | `302` redirect to `http://10.42.0.1/` for captive portal detection |

The catch-all `302` redirect (not `200`) is what triggers the OS captive portal popup on:
- **Apple:** `GET /hotspot-detect.html` and `captive.apple.com` paths
- **Android:** `GET /generate_204`, `/gen_204`
- **Windows:** `GET /connecttest.txt`, `/ncsi.txt`

### DNS Requirement

For captive portal auto-detection, **all DNS queries** from connected clients must resolve to the device's AP address (`10.42.0.1`). NetworkManager's `ipv4.method: shared` starts dnsmasq, but by default it only forwards queries upstream (which fails in AP mode — no internet).

The install and deploy scripts automatically create:

```
/etc/NetworkManager/dnsmasq-shared.d/captive-portal.conf
  address=/#/10.42.0.1
```

NetworkManager picks this up on the next shared connection activation (i.e. the next AP start).

### Wizard UI

A single self-contained HTML page with three steps (no external assets — the device has no internet in AP mode):

1. **Select network** — list of scanned WiFi networks with SSID, signal strength bars, lock icon for secured networks, refresh button
2. **Enter password** — shown for secured networks only; password input with show/hide toggle, back/connect buttons
3. **Connecting / Result** — spinner while connecting; success message ("Connected! This page will close.") or failure message with retry button

### Integration in main.ts

```typescript
const captivePortal = new CaptivePortal(networkManager);

// In enterApMode():
captivePortal.start(() => {
    exitApMode();  // onConnected callback
});

// In exitApMode() and handleWifiProvisioned():
captivePortal.stop();
```

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
| `activateSavedWifiConnection(timeoutMs?)` | `Promise<boolean>` | Reactivate the first saved WiFi connection using `ActivateConnection`. Used after AP teardown to reconnect without creating duplicate profiles. Polls until `Activated` or timeout (default 30 s). |
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
| `org.freedesktop.NetworkManager` | `/org/freedesktop/NetworkManager` | `GetDevices`, `ActivateConnection`, `AddAndActivateConnection`, `DeactivateConnection` |
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

## D-Bus Variant Unwrapping

The `dbus-native` library returns D-Bus variants in a nested array structure:

```javascript
// dbus-native returns:
[[{type: 'u', child: []}], [2]]

// NOT the simpler format some docs suggest:
['u', 2]
```

The `unwrapVariant()` helper in `network.manager.ts` extracts the actual value from this structure. It handles nested variants, arrays of variants, and direct values. All `getProperty()` and `getAllProperties()` calls use this helper.

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
