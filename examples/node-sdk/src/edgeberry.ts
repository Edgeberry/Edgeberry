/*
 *  Edgeberry Device SDK
 *  Thin wrapper around the `io.edgeberry.Core` D-Bus interface exposed by
 *  the Edgeberry Device Software. Lets applications send telemetry, publish
 *  application info/status, trigger device identification and subscribe to
 *  cloud-to-device messages without dealing with D-Bus plumbing directly.
 */

import { EventEmitter } from 'events';
import * as dbus from 'dbus-next';

/** D-Bus service, object path and interface names owned by the Edgeberry Core. */
export const EDGEBERRY_SERVICE = 'io.edgeberry.Core';
export const EDGEBERRY_OBJECT_PATH = '/io/edgeberry/Core';
export const EDGEBERRY_INTERFACE = 'io.edgeberry.Core';

/** Application metadata reported to the Device Hub. */
export interface ApplicationInfo {
  name: string;
  version: string;
  description?: string;
}

/** Application health/status level reported to the Device Hub. */
export type ApplicationStatusLevel = 'ok' | 'warning' | 'error' | 'critical' | string;

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
  private bus: dbus.MessageBus | null = null;
  private iface: dbus.ClientInterface | null = null;
  private ifacePromise: Promise<dbus.ClientInterface> | null = null;

  constructor(options: EdgeberryOptions = {}) {
    super();
    this.busKind = options.bus ?? 'system';
  }

  /**
   * Trigger the on-device identification routine (LED blink + beep).
   */
  async identify(): Promise<void> {
    const iface = await this.getInterface();
    await iface.Identify();
  }

  /**
   * Publish application metadata (name, version, description) to the Device Hub.
   * @returns the raw response string from the Core service (`'ok'` on success).
   */
  async setApplicationInfo(info: ApplicationInfo): Promise<string> {
    const iface = await this.getInterface();
    return iface.SetApplicationInfo(JSON.stringify(info));
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
    return iface.SetApplicationStatus(JSON.stringify(payload));
  }

  /**
   * Send a telemetry message to the Device Hub.
   * @returns the raw response string from the Core service. `'ok'` on success,
   *          `'err:not_initialized'`, `'err:not_connected'`, or
   *          `'err:invalid_data'` on the various failure paths.
   */
  async sendMessage(data: unknown): Promise<string> {
    const iface = await this.getInterface();
    return iface.SendMessage(JSON.stringify(data));
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
    const raw: string = await iface.GetState();
    if (!raw) throw new Error('Edgeberry: GetState returned an empty response');
    return JSON.parse(raw) as DeviceState;
  }

  /**
   * Release the D-Bus connection. Safe to call multiple times.
   */
  close(): void {
    if (this.bus) {
      try {
        this.bus.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.bus = null;
    this.iface = null;
    this.ifacePromise = null;
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

  /** Lazily connect to D-Bus and resolve the Edgeberry Core interface proxy. */
  private getInterface(): Promise<dbus.ClientInterface> {
    if (this.iface) return Promise.resolve(this.iface);
    if (this.ifacePromise) return this.ifacePromise;
    this.ifacePromise = (async () => {
      this.bus = this.busKind === 'system' ? dbus.systemBus() : dbus.sessionBus();
      const proxy = await this.bus.getProxyObject(EDGEBERRY_SERVICE, EDGEBERRY_OBJECT_PATH);
      const iface = proxy.getInterface(EDGEBERRY_INTERFACE);
      this.iface = iface;
      return iface;
    })();
    this.ifacePromise.catch(() => {
      this.ifacePromise = null;
    });
    return this.ifacePromise;
  }
}
