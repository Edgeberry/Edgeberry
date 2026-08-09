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

### Registering your application

Describe your application in an `edgeberry.json` inside its own directory, and register it once — from your installer:

```sh
sudo edgeberry --register-application /opt/MyApp
```

```json
{
  "name": "MyApp",
  "version": "1.2.0",
  "description": "What it does",

  "ui":       { "port": 1880 },
  "service":  { "unit": "myapp.service", "supports": ["restart", "stop", "reload"] },
  "branding": { "logo": "assets/logo.png", "mark": "assets/favicon.ico" }
}
```

The manifest carries what is settled when you install: the port your web server listens on, the systemd unit Edgeberry may act on, and the artwork the interface should wear. That gets you three things.

**Lifecycle** — the Device Hub can restart, stop, start and reload your application, limited to the actions you list in `supports`.

**Routing** — everything under `/application/` is proxied to your port, with the prefix stripped:

```
http://<device>/application/editor   ->   http://127.0.0.1:1880/editor
```

nginx knows nothing about the paths behind it, so you can add, move or remove pages freely and nothing on the device is regenerated.

> [!IMPORTANT]
> Because the prefix is stripped, your pages must use **relative URLs** — or read the `X-Forwarded-Prefix: /application` header and prepend it. An absolute `/editor/style.css` in your HTML leaves the prefix behind, lands on the device's catch-all, and 404s. This is the usual requirement for anything served under a sub-path. Node-RED, for example, needs `httpAdminRoot` and its `ui-base` path set accordingly.

**Branding** — this is how the whole device is branded. `logo` replaces the Edgeberry logo in the navigation bar, `mark` becomes the browser tab icon, and `colors` restyles the interface:

```json
"branding": {
  "logo":   "assets/logo.png",
  "mark":   "assets/favicon.ico",
  "colors": { "fg": "#E1E2E4", "bg": "#292B2D", "primary": "#A2CA6F" }
}
```

`logo` and `mark` are paths relative to your application's directory; a path pointing outside it is refused, since the device serves whatever it names. `.svg`, `.png`, `.ico`, `.jpg`, `.webp` and `.gif` are accepted.

`colors` takes four:

| | |
|---|---|
| `fg` | Text |
| `bg` | Page surface |
| `primary` | Your brand colour. Replaces Edgeberry's blue everywhere it appears — buttons, links, headings, icons |
| `secondary` | A second accent. Follows `primary` unless you set it |

Setting `primary` alone already makes the interface yours. Hex may be written with or without the leading `#`; an unknown colour name is an error rather than a silent no-op.

Everything here is optional, and anything you leave out keeps the device's own. Colours apply as soon as the interface polls, without a restart.

Only the path is stored. The manifest stays with your application and is re-read on every start, so shipping a new version updates what the device knows about you without re-registering.

### Declaring your pages

Routing does not need declaring — the pass-through already covers it. What you declare is your **menu**: which pages the interface should offer, and how. Do it over D-Bus, whenever it changes:

```js
await device.setApplicationInfo({
  name: 'MyApp',
  version: '1.2.0',
  routes: [
    { label: 'Dashboard', path: '/dashboard', default: true },
    { label: 'Editor',    path: '/editor', target: 'tab' },
  ],
});
```

| Field | |
|-------|--|
| `label` | Menu text |
| `path` | The path **inside your application**, as your own web server sees it — the device serves it at `/application` + this. Or an absolute `http(s)` URL for somewhere off the device entirely, linked as-is |
| `target` | `iframe` shows the page inside the interface; `tab` opens a browser tab. Defaults to `iframe` for your own pages and `tab` for an absolute URL. Use `tab` for anything that refuses to be framed, such as most editors |
| `default` | Which page opens when the application is selected. Mark none and the first framed page wins |

Menu items need not be pages you serve. An absolute URL — your documentation, your repository, a hosted dashboard — is just as valid, and opens in a tab unless you say otherwise:

```js
{ label: 'Repository', path: 'https://github.com/Freya-Vivariums', target: 'tab' }
```

Paths are yours to choose — `/api` here means *your* `/api`, since everything sits under the prefix. Your last declaration is remembered, so the menu survives a device restart rather than emptying until you declare again.

Bad routes are dropped individually and the reason is logged. `SetApplicationInfo` answers `ok` either way, so `journalctl -u io.edgeberry.core` is where to look if a menu item never appears:

| | |
|---|---|
| `..` in a path | Refused — it would climb out of your prefix |
| Two routes on one path | Refused; `/x` and `/x/` count as the same |
| `service.unit` | Must be a unit systemd already knows |
| Generated config | `nginx -t` must pass before anything is reloaded |

If your application previously installed its own `.conf` into `routes.d/`, registering replaces it — the old file is kept alongside as `.conf.replaced`.

`edgeberry --application` shows what is registered, `edgeberry --unregister-application` withdraws it and its routes.

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
| `SetApplicationInfo` | `{"name":…,"version":…,"description":…,"routes":[…]}` | Identify your application and populate its menu — see [Declaring your pages](#declaring-your-pages) |
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

## License & Collaboration

**Copyright© 2024 Sanne 'SpuQ' Santens**. The Edgeberry Device Software is licensed under the **[GNU GPLv3](LICENSE.txt)**. The [Rules & Guidelines](https://github.com/Edgeberry/.github/blob/main/brand/Edgeberry_Trademark_Rules_and_Guidelines.md) apply to the usage of the Edgeberry™ brand.

To contribute: fork the repository, branch from `main`, keep to the existing style, test on a real device, and open a pull request describing the problem your change addresses.
