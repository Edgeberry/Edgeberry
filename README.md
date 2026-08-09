![Edgeberry Banner](https://raw.githubusercontent.com/Edgeberry/.github/main/brand/Edgeberry_banner_device_software.png)

The **Edgeberry Device Software** turns a Raspberry Pi into a managed IoT device, so you only have to write your application.

It handles the parts every connected device needs and nobody wants to build twice: getting on WiFi without a monitor, enrolling with a cloud back end using X.509 certificates, keeping that connection alive through outages, reporting device state, and accepting remote commands. Your application talks to it over a local D-Bus API — send telemetry, receive cloud messages, report health — and never touches MQTT, certificates or reconnection logic.

On an Edgeberry Base Board it also drives the status LED and buzzer and listens to the user button, so the device can be operated and diagnosed without a screen.

## Installation

```sh
wget -O install.sh https://github.com/Edgeberry/Edgeberry/releases/latest/download/install.sh
chmod +x ./install.sh
sudo ./install.sh -y
```

The installer sets up the service, the web interface and the `edgeberry` CLI. It needs a network connection — for a device that has none yet, connect it by Ethernet for the install, or flash a WiFi network into the SD card image first.

## First run: getting on WiFi

With no WiFi network configured, the device brings up its own open network named **`EDGB-XXXXXX`**. Join it from a phone or laptop and the setup page opens by itself. If it doesn't, browse to **http://10.42.0.1**.

Pick a network, enter the password, and the device joins it and shuts its own network down.

You can return to access point mode at any time: hold the user button for ~3 seconds, or use the switch behind the WiFi icon in the web interface. The switch is locked while no network is configured, because leaving with nowhere to return to would make the device unreachable.

> [!IMPORTANT]
> If the device can no longer reach its saved network — after a move, for example — **the button is the only way back**. It is on no network at that point, so the web interface cannot be reached either. This is deliberate: the device never silently reconfigures itself.

A device works perfectly well with no internet connection. Nothing forces you to connect it.

## The web interface

Open the device's address in a browser (port 80, no login). It gives you:

- **Status** — what the device is, what it is connected to, and whether your application is healthy.
- **Network** — WiFi networks in range, saved networks, the access point switch, static IP configuration.
- **Cloud** — the Device Hub connection: host, device identity, certificate status and expiry. This is the same thing `sudo edgeberry --setup` does from the command line.
- **Application** — your Node-RED dashboard, if you have one.
- **Terminal** — a root shell on the device.

> [!WARNING]
> The web interface has no authentication, and the terminal it offers is a root shell. Put the device on a trusted network. While it is in access point mode its network is open, and anyone in radio range can reach both.

## Connecting to a Device Hub

You need the hostname of your Edgeberry Device Hub. Enter it on the **Cloud** page, or run `sudo edgeberry --setup`.

The device generates a private key, requests a certificate through fleet provisioning, and stores the result. From then on it connects on its own at boot, and reconnects after an outage with exponential backoff so a fleet coming back at once doesn't overwhelm the hub.

## Using the bridge

The device software is the only thing that speaks MQTT. Your application uses the local D-Bus API; certificates, topics and reconnection stay on this side of the bridge.

**Device to cloud** — your application pushes:

| What | Call | Arrives at the hub as |
|------|------|-----------------------|
| Telemetry | `SendMessage` | A telemetry message, timestamped and tagged with the device ID |
| Health | `SetApplicationStatus` | Application status — also drives the status LED and buzzer |
| Identity | `SetApplicationInfo` | Application name, version and description |
| Device state | *automatic* | The device shadow, updated on every change — network, connection, system and application state. Your application does nothing for this. |

**Cloud to device** — the hub sends a message, your application receives it as a `CloudMessage` signal. Messages are one-way: nothing is sent back automatically, so if you want to answer one, send telemetry with your own correlation ID.

Remote management — rebooting, identifying, reporting network details — is handled by the device software on its own, without involving your application.

**Across an outage** the two directions behave differently. The device keeps a persistent session, so cloud-to-device messages sent while it was away are delivered once it returns. Telemetry is not buffered: `SendMessage` returns `err:not_connected` and the data is gone. If it must survive a disconnection, your application has to hold onto it — check the return value rather than assuming delivery.

## Physical controls

Button:

| Press | Action |
|-------|--------|
| Short | Beep — acknowledges the button works |
| ~3 seconds | Toggle access point mode |
| ~5 seconds | Reboot |

Status LED — the device reports the most serious thing wrong, so read from the top:

| Pattern | Meaning |
|---------|---------|
| Constant red | Internal fault |
| Orange, alternating red | Rebooting |
| Orange blink | Access point mode |
| Red blink, slow (500 ms) | No network |
| Red blink, fast (300 ms) | Network up, but no Device Hub connection |
| Orange, fast (70 ms) | Provisioning, or connecting to the hub |
| Green heartbeat | Connected and healthy |
| Green/orange heartbeat | Connected, application reports a warning |
| Fast red flash + beeping | Application reports critical |
| Very fast red flash + rapid beeping | Application reports emergency |

The last four follow the health your application reports through `SetApplicationStatus`.

## CLI

```sh
sudo edgeberry --help
```

Covers setup, version, service control (`--start`, `--stop`, `--restart`, `--enable`, `--disable`), the hardware UUID and base board version, and `--identify` to make a device announce itself physically — useful for finding one device among many.

## Building an application

Your application runs as its own process and talks to the device software over D-Bus.

### Python

```sh
pip install edgeberry
```

See [sdk/python](sdk/python) for the API reference and examples.

### Node.js

```sh
npm install @edgeberry/device-sdk
```

```js
import { Edgeberry } from '@edgeberry/device-sdk';

const device = new Edgeberry();

// Cloud to device: react to messages from the hub
await device.onCloudMessage((message) => {
  console.log('From the hub:', message);
});

// Device to cloud: send telemetry, and notice when it doesn't arrive
setInterval(async () => {
  const result = await device.sendMessage({ temperature: 22.5 });
  if (result !== 'ok') console.warn('Not sent:', result);   // err:not_connected
}, 5000);

await device.setApplicationStatus({ level: 'ok', message: 'Running' });
```

The example is ESM, so it needs `"type": "module"` in your `package.json` or an `.mjs` file. See [sdk/node](sdk/node) for the API reference, TypeScript types and a fuller example.

### Node-RED

Install [Node-RED](https://nodered.org/docs/getting-started/raspberrypi) and the [Edgeberry node](https://flows.nodered.org/node/@edgeberry/device-node-red-contrib). Its dashboard then shows up on the **Application** page of the web interface.

> [!TIP]
> Do install the **Raspberry Pi specific nodes** during Node-RED setup.

### D-Bus directly

If there is no SDK for your language, use `io.edgeberry.Core` on the system bus at `/io/edgeberry/Core`.

**Methods:**

| Method | Argument | Purpose |
|--------|----------|---------|
| `SendMessage` | `{"temperature":22.5}` — any JSON | Send telemetry to the cloud. Returns `ok`, `err:not_connected` or `err:invalid_data` |
| `SetApplicationInfo` | `{"name":…,"version":…,"description":…}` | Identify your application |
| `SetApplicationStatus` | `{"level":"ok\|warning\|error\|critical\|emergency","message":…}` | Report health; drives the status LED |
| `GetState` | — | Current device state as JSON |
| `Identify` | — | Blink and beep to physically locate the device |

**Signals:**

| Signal | Payload |
|--------|---------|
| `CloudMessage` | Cloud-to-device message, JSON |
| `ButtonEvent` | `click`, `pressrelease`, `apToggle`, `longpress`, `verylongpress` |
| `StateUpdate` | Device state, JSON, on every change |

Introspect the live interface on a device:

```sh
sudo dbus-send --system --type=method_call --print-reply \
     --dest=io.edgeberry.Core /io/edgeberry/Core \
     org.freedesktop.DBus.Introspectable.Introspect
```

`sudo` is required — the D-Bus policy restricts this interface to root.

### Adding your own web routes

Drop an nginx `location` block into `/opt/Edgeberry/Core/config/nginx/routes.d/`. It is matched ahead of the device software's own catch-all, so you can serve your application alongside the device UI on port 80.

### Branding

Every colour in the web interface comes from CSS custom properties, so you can restyle it for your own project without touching the code. Create `/etc/edgeberry/theme/brand.css`:

```css
:root {
  --eb-accent:    #ff6600;
  --eb-navbar-bg: #101820;
}
```

That path takes precedence over the shipped theme, so your branding survives a software update. Overriding `--eb-accent` alone is usually enough; see [share/theme/tokens.css](share/theme/tokens.css) for the full set.

## License & Collaboration

**Copyright© 2024 Sanne 'SpuQ' Santens**. The Edgeberry Device Software is licensed under the **[GNU GPLv3](LICENSE.txt)**. The [Rules & Guidelines](https://github.com/Edgeberry/.github/blob/main/brand/Edgeberry_Trademark_Rules_and_Guidelines.md) apply to the usage of the Edgeberry™ brand.

To contribute: fork the repository, branch from `main`, keep to the existing style, test on a real device, and open a pull request describing the problem your change addresses.
