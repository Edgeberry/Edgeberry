/*
 *  Edgeberry Device SDK
 *  Thin wrapper around the `io.edgeberry.Core` D-Bus interface exposed by
 *  the Edgeberry Device Software. Lets applications send telemetry, publish
 *  application info/status, trigger device identification and subscribe to
 *  cloud-to-device messages without dealing with D-Bus plumbing directly.
 */

import { EventEmitter } from 'events';

// Same D-Bus library as the Edgeberry Device Software and the hardware drivers,
// so a device that runs an application alongside them installs one copy rather
// than two. It ships no TypeScript definitions, hence the require and the `any`
// typed handles below.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const dbus = require('dbus-native');

/**
 * Promisify a dbus-native method call. Every method on the Edgeberry interface
 * takes its arguments followed by a node-style callback.
 */
function callMethod<T>(iface: any, name: string, args: unknown[] = []): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    iface[name](...args, (err: unknown, result: T) => {
      if (err) return reject(err instanceof Error ? err : new Error(String(err)));
      resolve(result);
    });
  });
}

/** D-Bus service, object path and interface names owned by the Edgeberry Core. */
export const EDGEBERRY_SERVICE = 'io.edgeberry.Core';
export const EDGEBERRY_OBJECT_PATH = '/io/edgeberry/Core';
export const EDGEBERRY_INTERFACE = 'io.edgeberry.Core';

/**
 * A view the application offers, shown in the device interface's application
 * menu. Node-RED, for instance, declares its dashboard and its editor.
 *
 * The device validates these and settles the optional fields, so exactly one
 * route ends up the default — the application's choice if it marked one,
 * otherwise the first framable view it listed.
 */
export interface ApplicationRoute {
  /** Menu label, e.g. 'Dashboard'. */
  label: string;
  /**
   * The path inside this application, as its own web server sees it
   * ('/dashboard'). The device serves it under its application prefix.
   *
   * May also be an absolute http(s) URL, for somewhere off the device
   * entirely — documentation, a repository — which is linked unchanged.
   */
  path: string;
  /** Opens when the application view is entered without naming a view. */
  default?: boolean;
  /**
   * 'iframe' shows it inside the device interface, 'tab' opens a browser tab.
   * Defaults to 'iframe' for a path and 'tab' for an absolute URL, since most
   * sites refuse to be framed.
   */
  target?: 'iframe' | 'tab';
  /**
   * Font Awesome icon for the menu item, from the free set the device bundles.
   *
   * The name alone gives the solid style ('gauge'); name a style first to reach
   * the others ('brands github', 'regular star'). The 'fa-' prefixes are
   * optional, so 'fa-brands fa-github' works as well. Left out, the item shows
   * whether it opens in the interface or in a tab.
   *
   * An unusable value is dropped by the device with a logged reason and the
   * item keeps its default icon — the route itself is unaffected.
   */
  icon?: string;
}

/** Application metadata reported to the Device Hub. */
export interface ApplicationInfo {
  name: string;
  version: string;
  description?: string;
  /** Views this application offers; see {@link ApplicationRoute}. */
  routes?: ApplicationRoute[];
}

/** Application health/status level reported to the Device Hub. */
export type ApplicationStatusLevel = 'ok' | 'warning' | 'error' | 'critical' | 'emergency' | string;

export interface ApplicationStatus {
  level: ApplicationStatusLevel;
  message?: string;
}

/** Handler invoked for each cloud-to-device message received via D-Bus. */
export type CloudMessageHandler = (payload: unknown) => void;

/** Hardware button event types emitted by the Edgeberry device. */
export type ButtonEventType =
  | 'click'          // short press (< ~1.7s)
  | 'pressrelease'   // long press (~1.7s - 2.5s)
  | 'apToggle'       // ~3s press — toggles WiFi provisioning AP mode
  | 'longpress'      // 5s+ press — triggers a device restart
  | 'verylongpress'; // 10s+ press — reserved for factory reset

/** Payload carried by the `ButtonEvent` D-Bus signal. */
export interface ButtonEvent {
  event: ButtonEventType;
  timestamp: number;
}

export type ButtonEventHandler = (event: ButtonEvent) => void;

/** Snapshot of the Edgeberry device's state. Mirrors `deviceState` in the device software. */
export interface DeviceState {
  system: {
    platform: string;
    state: string;                // Running | Restarting | Updating | Starting
    version: string;
    board: string | null;
    board_version: string | null;
    uuid: string | null;
  };
  connection: {
    state: string;
    provision: string;            // Provisioned | Provisioning | Not provisioned | Disabled
    connection: string;           // Connected | Disconnected | Connecting
    network: string;              // Connected | Disconnected
    wifi: string;                 // ap_mode | connected | disconnected
  };
  application: {
    state: string;                // Running | Restarting | Stopping | Stopped
    connection: string;
    version: string;
  };
}

export type StateHandler = (state: DeviceState) => void;

/** Options accepted by the `Edgeberry` constructor. */
export interface EdgeberryOptions {
  /**
   * D-Bus bus to connect to. Defaults to the system bus, which is what the
   * Edgeberry Device Software uses in production.
   */
  bus?: 'system' | 'session';
}

/**
 * Client for the Edgeberry Device Software D-Bus API.
 *
 * The connection to D-Bus is established lazily on the first call. Consumers
 * that keep long-running processes should call `close()` on shutdown to
 * release the bus connection cleanly.
 */
export class Edgeberry extends EventEmitter {
  private readonly busKind: 'system' | 'session';
  private bus: any = null;
  private iface: any = null;
  private ifacePromise: Promise<any> | null = null;
  /**
   * The last application info that was set. The Core keeps application info in
   * memory only, so it forgets it when the service restarts; remembering it
   * here is what lets us tell the new instance again.
   */
  private lastInfo: ApplicationInfo | null = null;
  private watchingRestart = false;

  constructor(options: EdgeberryOptions = {}) {
    super();
    this.busKind = options.bus ?? 'system';
  }

  /**
   * Trigger the on-device identification routine (LED blink + beep).
   */
  async identify(): Promise<void> {
    const iface = await this.getInterface();
    await callMethod<void>(iface, 'Identify');
  }

  /**
   * Publish application metadata (name, version, description) to the Device Hub.
   * @returns the raw response string from the Core service (`'ok'` on success).
   */
  async setApplicationInfo(info: ApplicationInfo): Promise<string> {
    // Remembered before the call, so info set while the Core is down is still
    // replayed once it comes up.
    this.lastInfo = info;
    const iface = await this.getInterface();
    return callMethod<string>(iface, 'SetApplicationInfo', [JSON.stringify(info)]);
  }

  /**
   * Publish an application status update. Accepts either an `ApplicationStatus`
   * object or a `(level, message)` positional pair for parity with the Python SDK.
   * @returns the raw response string from the Core service (`'ok'` on success).
   */
  async setApplicationStatus(status: ApplicationStatus): Promise<string>;
  async setApplicationStatus(level: ApplicationStatusLevel, message?: string): Promise<string>;
  async setApplicationStatus(
    statusOrLevel: ApplicationStatus | ApplicationStatusLevel,
    message?: string,
  ): Promise<string> {
    const payload: ApplicationStatus =
      typeof statusOrLevel === 'string'
        ? { level: statusOrLevel, message }
        : statusOrLevel;
    const iface = await this.getInterface();
    return callMethod<string>(iface, 'SetApplicationStatus', [JSON.stringify(payload)]);
  }

  /**
   * Send a telemetry message to the Device Hub.
   * @returns the raw response string from the Core service. `'ok'` on success,
   *          `'err:not_initialized'`, `'err:not_connected'`, or
   *          `'err:invalid_data'` on the various failure paths.
   */
  async sendMessage(data: unknown): Promise<string> {
    const iface = await this.getInterface();
    return callMethod<string>(iface, 'SendMessage', [JSON.stringify(data)]);
  }

  /**
   * Subscribe to cloud-to-device messages emitted by the Core as the
   * `CloudMessage` D-Bus signal. The incoming JSON payload is parsed before
   * being handed to the handler.
   *
   * @returns an unsubscribe function that removes the handler.
   */
  async onCloudMessage(handler: CloudMessageHandler): Promise<() => void> {
    return this.subscribeJson('CloudMessage', handler);
  }

  /**
   * Subscribe to hardware button events. Fires on every press with the
   * classified event type (`click`, `pressrelease`, `apToggle`, `longpress`,
   * `verylongpress`) and a `timestamp` (ms since epoch).
   *
   * @returns an unsubscribe function that removes the handler.
   */
  async onButtonEvent(handler: ButtonEventHandler): Promise<() => void> {
    return this.subscribeJson<ButtonEvent>('ButtonEvent', handler);
  }

  /**
   * Subscribe to device state updates. Fires every time any part of the
   * device state (system / connection / application) changes.
   *
   * @returns an unsubscribe function that removes the handler.
   */
  async onState(handler: StateHandler): Promise<() => void> {
    return this.subscribeJson<DeviceState>('StateUpdate', handler);
  }

  /**
   * Fetch the current device state on demand (without waiting for the next
   * `StateUpdate` signal).
   */
  async getState(): Promise<DeviceState> {
    const iface = await this.getInterface();
    const raw = await callMethod<string>(iface, 'GetState');
    if (!raw) throw new Error('Edgeberry: GetState returned an empty response');
    return JSON.parse(raw) as DeviceState;
  }

  /**
   * Release the D-Bus connection. Safe to call multiple times.
   */
  close(): void {
    if (this.bus) {
      try {
        this.bus.connection.end();
      } catch {
        /* ignore */
      }
    }
    this.bus = null;
    this.iface = null;
    this.ifacePromise = null;
    this.lastInfo = null;
    this.watchingRestart = false;
  }

  /**
   * Re-send the remembered application info whenever the Core service claims
   * its bus name again, which is what a restart looks like from here.
   */
  private async watchForRestart(): Promise<void> {
    if (this.watchingRestart) return;
    try {
      const dbusIface = await this.getServiceInterface(
        'org.freedesktop.DBus',
        '/org/freedesktop/DBus',
        'org.freedesktop.DBus',
      );
      dbusIface.on('NameOwnerChanged', (name: string, _oldOwner: string, newOwner: string) => {
        // An empty newOwner is the name being released — the Core going away.
        // Only its arrival is interesting.
        if (name !== EDGEBERRY_SERVICE || !newOwner) return;
        this.resendApplicationInfo();
      });
      this.watchingRestart = true;
    } catch {
      /* Without the watcher everything else still works; info just is not replayed. */
    }
  }

  private resendApplicationInfo(): void {
    const info = this.lastInfo;
    if (!info) return;
    // The Core owns the name a moment before it has finished exporting the
    // interface, so give it that moment rather than racing it. A failure here
    // is not the caller's problem — they never asked for this call.
    setTimeout(() => {
      if (!this.iface) return;
      callMethod<string>(this.iface, 'SetApplicationInfo', [JSON.stringify(info)]).catch(() => {});
    }, 500);
  }

  /**
   * Subscribe to a D-Bus signal whose payload is a single JSON-encoded string.
   * Falls back to the raw string if `JSON.parse` fails.
   */
  private async subscribeJson<T = unknown>(
    signalName: string,
    handler: (payload: T) => void,
  ): Promise<() => void> {
    const iface = await this.getInterface();
    const listener = (json: string) => {
      let payload: T | string = json;
      try {
        payload = JSON.parse(json) as T;
      } catch {
        /* leave payload as raw string on parse failure */
      }
      handler(payload as T);
    };
    iface.on(signalName, listener);
    return () => {
      iface.off(signalName, listener);
    };
  }

  /**
   * Resolve a D-Bus interface proxy. dbus-native introspects the object and
   * hands the interface back through a callback.
   */
  private getServiceInterface(service: string, objectPath: string, interfaceName: string): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      this.bus
        .getService(service)
        .getInterface(objectPath, interfaceName, (err: unknown, iface: any) => {
          if (err) return reject(err instanceof Error ? err : new Error(String(err)));
          resolve(iface);
        });
    });
  }

  /** Lazily connect to D-Bus and resolve the Edgeberry Core interface proxy. */
  private getInterface(): Promise<any> {
    if (this.iface) return Promise.resolve(this.iface);
    if (this.ifacePromise) return this.ifacePromise;
    this.ifacePromise = (async () => {
      this.bus = this.busKind === 'system' ? dbus.systemBus() : dbus.sessionBus();
      const iface = await this.getServiceInterface(
        EDGEBERRY_SERVICE,
        EDGEBERRY_OBJECT_PATH,
        EDGEBERRY_INTERFACE,
      );
      this.iface = iface;
      await this.watchForRestart();
      return iface;
    })();
    this.ifacePromise.catch(() => {
      this.ifacePromise = null;
    });
    return this.ifacePromise;
  }
}
