/*
 *  Device API client
 *
 *  One place where the shape of the device's HTTP API is written down. Pages
 *  previously called fetch() directly, which spread URL strings, error handling
 *  and response shapes across every component that needed data.
 *
 *  Every call resolves or throws — callers never inspect status codes.
 */

/* ── Response shapes ────────────────────────────────────────── */

export type WifiState       = 'ap_mode' | 'connected' | 'disconnected' | 'unknown'
export type ProvisionState  = 'disabled' | 'provisioned' | 'not provisioned' | 'provisioning' | 'unknown'
export type ConnectionState = 'connected' | 'disconnected' | 'connecting' | 'unknown'
/** Severity an application reports over the SDK. The device does not validate
 *  the level it is given, so treat anything outside this set as unknown. */
export type AppHealth       = 'ok' | 'warning' | 'error' | 'critical' | 'emergency' | 'unknown'

export type DeviceState = {
  system: {
    platform:      string
    state:         string
    version:       string
    board:         string | null
    board_version: string | null
    uuid:          string | null
    hostname:      string
    apSsid:        string | null
  }
  connection: {
    state:      string
    provision:  ProvisionState
    connection: ConnectionState
    network:    string
    wifi:       WifiState
    hubHost:    string | null
  }
  /** name/description/version/routes come from SetApplicationInfo, health/message
   *  from SetApplicationStatus. Null when the application has not reported yet. */
  application: {
    state:       string
    health:      AppHealth
    connection:  string
    name:        string | null
    description: string | null
    version:     string | null
    message:     string | null
    /** Where the registered application is reachable as a whole; null when none. */
    base:        string | null
    routes:      ApplicationRoute[]
  }
}

/**
 * A view the application offers, declared through SetApplicationInfo and shown
 * in the application menu.
 *
 * The device validates and settles these before serving them, so every field is
 * present and exactly one route is the default — see application.ts.
 */
export type ApplicationRoute = {
  label:   string
  /** The path *inside the application*, as it declared it. */
  path:    string
  /** Where to actually open it: `path` under the pass-through prefix, or an
   *  absolute URL unchanged. Use this, not `path`. */
  url:     string
  /** 'iframe' shows the view inside this interface; 'tab' opens a browser tab. */
  target:  'iframe' | 'tab'
  default: boolean
  /** What `?view=` names this route by. */
  slug:    string
}

/** Anything absent on this hardware comes back null and is left off the panel. */
export type SystemInfo = {
  system: {
    hostname:     string
    model:        string | null
    serial:       string | null
    osName:       string | null
    kernel:       string
    architecture: string
    cpu:          string | null
    cpuCores:     number
    memoryTotal:  number
    memoryFree:   number
    diskTotal:    number | null
    diskFree:     number | null
    uptime:       number
    version:      string | null
  }
  board: {
    vendor:  string | null
    product: string | null
    id:      string | null
    version: string | null
    uuid:    string | null
  }
}

export type AccessPoint  = { ssid: string; strength: number; frequency: number; secured: boolean }
export type SavedNetwork = { ssid: string; autoconnect: boolean }
export type WifiData     = { available: AccessPoint[]; saved: SavedNetwork[]; active: string | null }

export type Address      = { address: string; family: string; mac: string; internal: boolean; cidr: string | null }
export type NetInterface = { name: string; addresses: Address[] }

export type ApStatus = {
  active:  boolean
  ssid:    string | null
  /** False when no non-AP network is saved: leaving AP mode would strand the device. */
  canExit: boolean
}

export type CertificateInfo = {
  present:        boolean
  subject?:       string
  issuer?:        string
  notAfter?:      string
  expired?:       boolean
  daysRemaining?: number
}

export type CloudStatus = {
  hostName:        string | null
  deviceId:        string | null
  configured:      boolean
  provisioned:     boolean
  provisionState:  string
  connectionState: string
  networkState:    string
  certificate:     CertificateInfo
}

export type IpMode = 'auto' | 'manual'

export type IpConfig = {
  ssid:     string
  mode:     IpMode
  address?: string
  prefix?:  number
  gateway?: string
  dns?:     string
}

/* ── Transport ──────────────────────────────────────────────── */

/** Thrown for any non-2xx response, carrying the server's message where it gave one. */
export class ApiError extends Error {
  // Declared explicitly rather than as a constructor parameter property: the
  // web UI compiles with `erasableSyntaxOnly`, which rules those out.
  readonly status: number

  constructor( message:string, status:number ){
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>( path:string, init?:RequestInit ):Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init?.headers } : init?.headers,
  })

  // Endpoints answer with JSON throughout, but a proxy error page or a crashed
  // service will not — surface that as an ApiError rather than a parse failure.
  let payload: any = null
  try { payload = await response.json() } catch { /* handled below */ }

  if (!response.ok)
    throw new ApiError(payload?.error ?? `Request failed (${response.status})`, response.status)
  if (payload === null)
    throw new ApiError('Malformed response from device', response.status)

  return payload as T
}

const post = <T>( path:string, body?:unknown ) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

/* ── Endpoints ──────────────────────────────────────────────── */

export const api = {
  getState:      () => request<DeviceState>('/api/state'),

  system: {
    getInfo:  () => request<SystemInfo>('/api/system/info'),
    reboot:   () => post<{ ok: true }>('/api/system/reboot'),
    shutdown: () => post<{ ok: true }>('/api/system/shutdown'),
    identify: () => post<{ ok: true }>('/api/system/identify'),
  },

  network: {
    getWifi:       () => request<WifiData>('/api/network/wifi'),
    getActiveSsid: () => request<{ ssid: string | null }>('/api/network/wifi/active'),
    getInterfaces: () => request<NetInterface[]>('/api/network/interfaces'),
    setIpConfig:   ( config:IpConfig ) => post<{ ok: true }>('/api/network/wifi/ipconfig', config),

    getAp:    () => request<ApStatus>('/api/network/ap'),
    /** Note: the device answers before acting — this page's connection then drops. */
    setAp:    ( enabled:boolean ) => post<{ ok: true }>('/api/network/ap', { enabled }),

    /**
     * Join a network. Resolves with `{ success: false }` for a rejected
     * passphrase — that is an expected outcome, not a transport failure.
     *
     * If the device is in access point mode, a successful join also ends it,
     * which drops the connection this call was made over.
     */
    join: ( ssid:string, passphrase:string ) =>
            post<{ success: boolean }>('/api/network/wifi/connect', { ssid, passphrase }),
  },

  cloud: {
    get:       () => request<CloudStatus>('/api/cloud'),
    provision: ( hostName:string ) => post<{ ok: true }>('/api/cloud/provision', { hostName }),
    reconnect: () => post<{ ok: true }>('/api/cloud/reconnect'),
    reset:     () => post<{ ok: true }>('/api/cloud/reset'),
  },
}
