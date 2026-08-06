import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BrowserRouter, NavLink, Routes, Route } from 'react-router-dom'
import { Modal } from 'bootstrap'
import { api, type ConnectionState, type ProvisionState, type WifiState } from './api'
import Network from './pages/Network'
import Cloud from './pages/Cloud'
import TerminalPage from './pages/Terminal'
import ApplicationPage from './pages/Application'

/* How often the navbar refreshes device state. /api/state is deliberately cheap
   for this reason — see the note on that route. */
const POLL_INTERVAL_MS = 10000

/* ── Status icons ───────────────────────────────────────────── */

function CloudIcon({ provision, connection, hubHost }: {
  provision: ProvisionState; connection: ConnectionState; hubHost: string | null
}) {
  // Fall back to the generic name only when no hub is configured yet.
  const hub = hubHost ?? 'Device Hub'

  if (provision === 'not provisioned')
    return <i className="fa-solid fa-cloud" style={{ color: 'var(--eb-idle)' }} title="Not configured" />
  if (provision === 'provisioning')
    return <i className="fa-solid fa-cloud" style={{ color: 'var(--eb-warn)' }} title={`Provisioning with ${hub}…`} />
  if (connection === 'connecting')
    return <i className="fa-solid fa-cloud" style={{ color: 'var(--eb-warn)' }} title={`Connecting to ${hub}…`} />
  if (connection === 'connected')
    return <i className="fa-solid fa-cloud" style={{ color: 'var(--eb-ok)' }} title={`Connected to ${hub}`} />
  if (connection === 'disconnected')
    return <i className="fa-solid fa-cloud" style={{ color: 'var(--eb-fault)' }} title={`Disconnected from ${hub}`} />
  return <i className="fa-solid fa-cloud" style={{ color: 'var(--eb-idle)' }} title="Cloud status unknown" />
}

function NetworkIcon({ wifi, network, ssid, apSsid }: {
  wifi: WifiState; network: string; ssid: string | null; apSsid: string | null
}) {
  // AP mode is the one state that is categorically different — the device is a
  // hotspot, not a client — so it carries a badge rather than only a hue shift.
  // Amber alone reads too close to the no-internet yellow on a navbar glyph.
  if (wifi === 'ap_mode')
    return (
      <span
        style={{ position: 'relative', display: 'inline-flex' }}
        title={apSsid ? `Access Point ${apSsid}` : 'Access Point'}
      >
        <i className="fa-solid fa-wifi" style={{ color: 'var(--eb-warn)' }} />
        <span
          style={{
            position: 'absolute', right: -5, bottom: -4,
            fontSize: '0.5rem', fontWeight: 700, lineHeight: 1,
            letterSpacing: '-0.02em', color: 'var(--eb-warn)',
            // Punches the badge out of the navbar so the glyph's tail does not
            // bleed through the lettering.
            background: 'var(--eb-navbar-bg)', padding: '0 1px', borderRadius: 2,
          }}
        >AP</span>
      </span>
    )

  if (wifi === 'connected' && network === 'connected')
    return <i className="fa-solid fa-wifi" style={{ color: 'var(--eb-ok)' }} title={ssid ? `Connected to ${ssid}` : 'WiFi connected'} />
  if (wifi === 'connected')
    return <i className="fa-solid fa-wifi" style={{ color: 'var(--eb-warn)' }} title={ssid ? `Connected to ${ssid} (no internet)` : 'WiFi connected (no internet)'} />
  if (wifi === 'disconnected')
    return <i className="fa-solid fa-wifi" style={{ color: 'var(--eb-idle)' }} title="WiFi disconnected" />
  return <i className="fa-solid fa-wifi" style={{ color: 'var(--eb-idle)' }} title="Network unknown" />
}

/* ── Navigation ─────────────────────────────────────────────── */

function NavMenu({ onOpenTerminal, onOpenPower }: { onOpenTerminal: () => void; onOpenPower: () => void }) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState({ top: 0, right: 0 })

  function toggle() {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    }
    setOpen(v => !v)
  }

  useEffect(() => {
    if (!open) return
    function close(e: MouseEvent) {
      if (btnRef.current && !btnRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const itemStyle = { color: 'var(--eb-navbar-fg)' }

  // Rendered into document.body: the navbar establishes a stacking context that
  // would otherwise clip the menu.
  const menu = open ? createPortal(
    <ul
      style={{
        position: 'fixed', top: pos.top, right: pos.right, zIndex: 99999,
        listStyle: 'none', margin: 0, padding: '0.25rem 0',
        backgroundColor: 'var(--eb-navbar-bg)', border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: '0.375rem', minWidth: 160,
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
      }}
      onMouseDown={e => e.stopPropagation()}
    >
      <li>
        <button className="dropdown-item d-flex align-items-center gap-2" style={itemStyle}
          onClick={() => { setOpen(false); onOpenTerminal() }}>
          <i className="fa-solid fa-terminal fa-fw" />Terminal
        </button>
      </li>
      <li><hr className="dropdown-divider" /></li>
      <li>
        <button className="dropdown-item d-flex align-items-center gap-2" style={itemStyle}
          onClick={() => { setOpen(false); api.system.identify().catch(() => {}) }}>
          <i className="fa-solid fa-location-dot fa-fw" />Identify
        </button>
      </li>
      <li><hr className="dropdown-divider" /></li>
      <li>
        <button className="dropdown-item d-flex align-items-center gap-2" style={itemStyle}
          onClick={() => { setOpen(false); onOpenPower() }}>
          <i className="fa-solid fa-power-off fa-fw" />Power
        </button>
      </li>
    </ul>,
    document.body
  ) : null

  return (
    <>
      <button
        ref={btnRef}
        className="btn btn-sm"
        style={{ color: 'var(--eb-navbar-fg)', lineHeight: 1, background: 'none', border: 'none', padding: '0.25rem 0.5rem' }}
        onClick={toggle}
        title="Menu"
      >
        <i className="fa-solid fa-ellipsis-vertical" />
      </button>
      {menu}
    </>
  )
}

type NavBarProps = {
  onOpenTerminal: () => void
  onOpenNetwork:  () => void
  onOpenCloud:    () => void
  onOpenPower:    () => void
  wifiState:       WifiState
  networkState:    string
  activeSsid:      string | null
  apSsid:          string | null
  provisionState:  ProvisionState
  connectionState: ConnectionState
  hubHost:         string | null
  hostname:        string
}

function NavBar(props: NavBarProps) {
  const iconButtonStyle = { lineHeight: 1, background: 'none', border: 'none', padding: '0.25rem 0.4rem' }

  return (
    <nav className="navbar navbar-dark" style={{ backgroundColor: 'var(--eb-navbar-bg)' }}>
      <div className="container-fluid" style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center' }}>
        <NavLink className="navbar-brand mb-0" to="/" style={{ justifySelf: 'start' }}>
          <img src="/theme/logo/logo.svg" alt="Edgeberry" height="28" />
        </NavLink>

        <span
          className="d-none d-sm-block fw-semibold text-truncate"
          style={{ color: 'var(--eb-navbar-fg)', fontSize: '0.9rem', maxWidth: 240, textAlign: 'center' }}
        >
          {props.hostname}
        </span>

        <div className="d-flex align-items-center gap-1" style={{ justifySelf: 'end' }}>
          <button className="btn btn-sm d-flex align-items-center" style={iconButtonStyle}
            onClick={props.onOpenNetwork} title="Network">
            <NetworkIcon wifi={props.wifiState} network={props.networkState} ssid={props.activeSsid} apSsid={props.apSsid} />
          </button>
          <button className="btn btn-sm d-flex align-items-center" style={iconButtonStyle}
            onClick={props.onOpenCloud}>
            <CloudIcon provision={props.provisionState} connection={props.connectionState} hubHost={props.hubHost} />
          </button>
          <NavMenu onOpenTerminal={props.onOpenTerminal} onOpenPower={props.onOpenPower} />
        </div>
      </div>
    </nav>
  )
}

/* ── Modals ─────────────────────────────────────────────────── */

/**
 * Bootstrap modal wrapper.
 *
 * Children are mounted only while the modal is open, so pages inside do not
 * poll the device in the background. They receive a `close` callback for the
 * cases where the content itself needs to dismiss the modal — the terminal does
 * this when its shell exits. `onReady` hands the caller a show() function
 * rather than exposing the Bootstrap instance.
 */
function ModalShell({ title, icon, onReady, bodyClassName, background, children }: {
  title:          string
  icon:           string
  onReady:        (show: () => void) => void
  bodyClassName?: string
  background?:    string
  children:       (open: boolean, close: () => void) => React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const elementRef  = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<Modal | null>(null)

  useEffect(() => {
    const element = elementRef.current
    if (!element) return

    const instance = new Modal(element)
    instanceRef.current = instance
    onReady(() => instance.show())

    const onShown  = () => setOpen(true)
    const onHidden = () => setOpen(false)
    element.addEventListener('shown.bs.modal', onShown)
    element.addEventListener('hidden.bs.modal', onHidden)

    return () => {
      element.removeEventListener('shown.bs.modal', onShown)
      element.removeEventListener('hidden.bs.modal', onHidden)
      instance.dispose()
      instanceRef.current = null
    }
  }, [])

  return (
    <div ref={elementRef} className="modal fade" tabIndex={-1} aria-hidden="true">
      <div className="modal-dialog modal-fullscreen">
        <div className="modal-content" style={{ background: background ?? 'var(--eb-bg)', border: 'none' }}>
          <div className="modal-header" style={{ background: 'var(--eb-navbar-bg)', border: 'none', padding: '0.5rem 1rem' }}>
            <span className="modal-title fw-semibold" style={{ color: 'var(--eb-navbar-fg)', fontSize: '0.9rem' }}>
              <i className={`fa-solid ${icon} me-2`} style={{ color: 'var(--eb-accent)' }} />{title}
            </span>
            <button type="button" className="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close" />
          </div>
          <div className={bodyClassName ?? 'modal-body'} style={{ overflow: 'auto' }}>
            {children(open, () => instanceRef.current?.hide())}
          </div>
        </div>
      </div>
    </div>
  )
}

function PowerModal({ onReady }: { onReady: (show: () => void) => void }) {
  const elementRef  = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<Modal | null>(null)
  const [busy, setBusy] = useState<'reboot' | 'shutdown' | null>(null)

  useEffect(() => {
    const element = elementRef.current
    if (!element) return
    const instance = new Modal(element)
    instanceRef.current = instance
    onReady(() => instance.show())
    return () => { instance.dispose(); instanceRef.current = null }
  }, [])

  async function trigger( action:'reboot' | 'shutdown' ) {
    setBusy(action)
    await (action === 'reboot' ? api.system.reboot() : api.system.shutdown()).catch(() => {})
    instanceRef.current?.hide()
    setBusy(null)
  }

  return (
    <div ref={elementRef} className="modal fade" tabIndex={-1} aria-hidden="true">
      <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: 340 }}>
        <div className="modal-content" style={{ background: 'var(--eb-bg)', border: '1px solid var(--eb-line)' }}>
          <div className="modal-header" style={{ background: 'var(--eb-navbar-bg)', border: 'none', padding: '0.5rem 1rem' }}>
            <span className="modal-title fw-semibold" style={{ color: 'var(--eb-navbar-fg)', fontSize: '0.9rem' }}>
              <i className="fa-solid fa-power-off me-2" style={{ color: 'var(--eb-accent)' }} />Power
            </span>
            <button type="button" className="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close" />
          </div>
          <div className="modal-body d-flex flex-column gap-2 p-3">
            <button className="btn btn-outline-warning w-100 d-flex align-items-center gap-2"
              onClick={() => trigger('reboot')} disabled={busy !== null}>
              <i className="fa-solid fa-rotate-right" />
              {busy === 'reboot' ? 'Rebooting…' : 'Reboot'}
            </button>
            <button className="btn btn-outline-danger w-100 d-flex align-items-center gap-2"
              onClick={() => trigger('shutdown')} disabled={busy !== null}>
              <i className="fa-solid fa-power-off" />
              {busy === 'shutdown' ? 'Shutting down…' : 'Shut down'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Shell ──────────────────────────────────────────────────── */

function AppShell() {
  const openTerminal = useRef<() => void>(() => {})
  const openNetwork  = useRef<() => void>(() => {})
  const openCloud    = useRef<() => void>(() => {})
  const openPower    = useRef<() => void>(() => {})

  const [wifiState,       setWifiState]       = useState<WifiState>('unknown')
  const [networkState,    setNetworkState]    = useState<string>('unknown')
  const [activeSsid,      setActiveSsid]      = useState<string | null>(null)
  const [apSsid,          setApSsid]          = useState<string | null>(null)
  const [provisionState,  setProvisionState]  = useState<ProvisionState>('unknown')
  const [connectionState, setConnectionState] = useState<ConnectionState>('unknown')
  const [hubHost,         setHubHost]         = useState<string | null>(null)
  const [hostname,        setHostname]        = useState<string>('')
  const [apNoticeDismissed, setApNoticeDismissed] = useState(false)

  useEffect(() => { if (hostname) document.title = hostname }, [hostname])

  // Re-arm the notice when AP mode ends, so the next entry announces itself
  // again rather than staying silently dismissed from a previous session.
  useEffect(() => { if (wifiState !== 'ap_mode') setApNoticeDismissed(false) }, [wifiState])

  useEffect(() => {
    const poll = () => {
      api.getState()
        .then(state => {
          setWifiState(state.connection.wifi ?? 'unknown')
          setNetworkState(state.connection.network ?? 'unknown')
          setProvisionState(state.connection.provision ?? 'unknown')
          setConnectionState(state.connection.connection ?? 'unknown')
          setHubHost(state.connection.hubHost ?? null)
          setHostname(state.system.hostname ?? '')
          setApSsid(state.system.apSsid ?? null)
        })
        .catch(() => {})

      api.network.getActiveSsid()
        .then(({ ssid }) => setActiveSsid(ssid))
        .catch(() => {})
    }

    poll()
    const timer = setInterval(poll, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [])

  return (
    <>
      <NavBar
        onOpenTerminal={() => openTerminal.current()}
        onOpenNetwork={() => openNetwork.current()}
        onOpenCloud={() => openCloud.current()}
        onOpenPower={() => openPower.current()}
        wifiState={wifiState}
        networkState={networkState}
        activeSsid={activeSsid}
        apSsid={apSsid}
        provisionState={provisionState}
        connectionState={connectionState}
        hubHost={hubHost}
        hostname={hostname}
      />

      <ModalShell title="Cloud Connection" icon="fa-cloud" onReady={fn => { openCloud.current = fn }}>
        {open => open && <Cloud />}
      </ModalShell>
      <ModalShell title="Network" icon="fa-wifi" onReady={fn => { openNetwork.current = fn }}>
        {open => open && <Network />}
      </ModalShell>
      <ModalShell
        title="Terminal"
        icon="fa-terminal"
        onReady={fn => { openTerminal.current = fn }}
        background="var(--eb-navbar-bg)"
        bodyClassName="modal-body p-0 d-flex flex-column"
      >
        {(open, close) => open && <TerminalPage onRequestClose={close} />}
      </ModalShell>
      <PowerModal onReady={fn => { openPower.current = fn }} />

      <div style={{ height: 'calc(100vh - 56px)' }}>
        <main style={{ overflow: 'auto', height: '100%', display: 'flex', flexDirection: 'column' }}>
          {/* Non-blocking: AP mode is a valid steady state for a device that
              never needs a network, so this offers setup rather than demanding
              it. flexShrink:0 keeps the flexing iframe below from squashing it. */}
          {wifiState === 'ap_mode' && !apNoticeDismissed && (
            <div
              className="d-flex align-items-center gap-2 px-3 py-2"
              style={{
                // Tinted from the status token so a rebranded --eb-warn carries
                // through to the banner rather than leaving it stranded amber.
                background: 'color-mix(in srgb, var(--eb-warn) 12%, transparent)',
                borderBottom: '1px solid color-mix(in srgb, var(--eb-warn) 35%, transparent)',
                fontSize: '0.85rem', flexShrink: 0,
              }}
            >
              <i className="fa-solid fa-wifi" style={{ color: 'var(--eb-warn)' }} />
              <span className="flex-grow-1">
                Access point mode
                {apSsid && <> — <span style={{ fontFamily: 'monospace' }}>{apSsid}</span></>}
              </span>
              <button className="btn btn-sm btn-outline-warning py-0" onClick={() => openNetwork.current()}>
                Configure network
              </button>
              <button className="btn-close btn-close-white" style={{ fontSize: '0.6rem' }}
                aria-label="Dismiss" onClick={() => setApNoticeDismissed(true)} />
            </div>
          )}

          <Routes>
            {/* '/' always shows the application. Edgeberry devices are useful
                with no network at all, so AP mode must not replace the app with
                a setup screen — the banner above offers configuration instead. */}
            <Route path="/" element={<ApplicationPage />} />
            <Route path="/network" element={<div className="p-4"><Network /></div>} />
            <Route path="/cloud" element={<div className="p-4"><Cloud /></div>} />
            <Route path="*" element={<div className="p-4"><ApplicationPage /></div>} />
          </Routes>
        </main>
      </div>
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  )
}
