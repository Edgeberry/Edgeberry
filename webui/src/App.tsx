import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BrowserRouter, NavLink, Routes, Route } from 'react-router-dom'
import { Modal } from 'bootstrap'
import Network from './pages/Network'
import TerminalPage from './pages/Terminal'
import ApplicationPage from './pages/Application'

type WifiState       = 'ap_mode' | 'connected' | 'disconnected' | 'unknown'
type ProvisionState  = 'disabled' | 'provisioned' | 'not provisioned' | 'provisioning' | 'unknown'
type ConnectionState = 'connected' | 'disconnected' | 'connecting' | 'unknown'

function CloudIcon({ provision, connection }: { provision: ProvisionState; connection: ConnectionState }) {
  if (provision === 'not provisioned')
    return <i className="fa-solid fa-cloud" style={{ color: 'rgba(255,255,255,0.3)' }} title="Not configured" />
  if (provision === 'provisioning')
    return <i className="fa-solid fa-cloud" style={{ color: '#f59e0b' }} title="Provisioning…" />
  if (connection === 'connecting')
    return <i className="fa-solid fa-cloud" style={{ color: '#f59e0b' }} title="Connecting…" />
  if (connection === 'connected')
    return <i className="fa-solid fa-cloud" style={{ color: '#4ade80' }} title="Connected to Device Hub" />
  if (connection === 'disconnected')
    return <i className="fa-solid fa-cloud" style={{ color: '#f87171' }} title="Disconnected from Device Hub" />
  return <i className="fa-solid fa-cloud" style={{ color: 'rgba(255,255,255,0.3)' }} title="Cloud status unknown" />
}

function NetworkIcon({ wifi, network, ssid, apSsid }: { wifi: WifiState; network: string; ssid: string | null; apSsid: string | null }) {
  // AP mode is the one state that is categorically different — the device is a
  // hotspot, not a client — so it carries a badge rather than only a hue shift.
  // Amber alone reads too close to the no-internet yellow on a navbar glyph.
  if (wifi === 'ap_mode')
    return (
      <span
        style={{ position: 'relative', display: 'inline-flex' }}
        title={apSsid ? `Access Point ${apSsid}` : 'Access Point'}
      >
        <i className="fa-solid fa-wifi" style={{ color: '#f59e0b' }} />
        <span
          style={{
            position: 'absolute', right: -5, bottom: -4,
            fontSize: '0.5rem', fontWeight: 700, lineHeight: 1,
            letterSpacing: '-0.02em', color: '#f59e0b',
            // Punches the badge out of the navbar so the glyph's tail does not
            // bleed through the lettering.
            background: 'var(--eb-fg)', padding: '0 1px', borderRadius: 2,
          }}
        >AP</span>
      </span>
    )
  if (wifi === 'connected' && network === 'connected')
    return <i className="fa-solid fa-wifi" style={{ color: '#4ade80' }} title={ssid ? `Connected to ${ssid}` : 'WiFi connected'} />
  if (wifi === 'connected')
    return <i className="fa-solid fa-wifi" style={{ color: '#facc15' }} title={ssid ? `Connected to ${ssid} (no internet)` : 'WiFi connected (no internet)'} />
  if (wifi === 'disconnected')
    return <i className="fa-solid fa-wifi" style={{ color: 'rgba(255,255,255,0.3)' }} title="WiFi disconnected" />
  return <i className="fa-solid fa-wifi" style={{ color: 'rgba(255,255,255,0.3)' }} title="Network unknown" />
}

function NavMenu({ onOpenTerminal, onOpenPower }: { onOpenTerminal: () => void; onOpenPower: () => void; }) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState({ top: 0, right: 0 })

  function toggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, right: window.innerWidth - r.right })
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

  const menu = open ? createPortal(
    <ul
      style={{
        position: 'fixed', top: pos.top, right: pos.right, zIndex: 99999,
        listStyle: 'none', margin: 0, padding: '0.25rem 0',
        backgroundColor: '#1e1e1e', border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: '0.375rem', minWidth: 160,
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
      }}
      onMouseDown={e => e.stopPropagation()}
    >
      <li>
        <button
          className="dropdown-item d-flex align-items-center gap-2"
          style={{ color: 'rgba(255,255,255,0.85)' }}
          onClick={() => { setOpen(false); onOpenTerminal() }}
        >
          <i className="fa-solid fa-terminal fa-fw" />Terminal
        </button>
      </li>
      <li><hr className="dropdown-divider" /></li>
      <li>
        <button
          className="dropdown-item d-flex align-items-center gap-2"
          style={{ color: 'rgba(255,255,255,0.85)' }}
          onClick={() => { setOpen(false); fetch('/api/system/identify', { method: 'POST' }).catch(() => {}) }}
        >
          <i className="fa-solid fa-location-dot fa-fw" />Identify
        </button>
      </li>
      <li><hr className="dropdown-divider" /></li>
      <li>
        <button
          className="dropdown-item d-flex align-items-center gap-2"
          style={{ color: 'rgba(255,255,255,0.85)' }}
          onClick={() => { setOpen(false); onOpenPower() }}
        >
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
        style={{ color: 'rgba(255,255,255,0.7)', lineHeight: 1, background: 'none', border: 'none', padding: '0.25rem 0.5rem' }}
        onClick={toggle}
        title="Menu"
      >
        <i className="fa-solid fa-ellipsis-vertical" />
      </button>
      {menu}
    </>
  )
}

function NavBar({ onOpenTerminal, onOpenNetwork, onOpenCloud, onOpenPower, wifiState, networkState, activeSsid, apSsid, provisionState, connectionState, hostname }:
  { onOpenTerminal: () => void; onOpenNetwork: () => void; onOpenCloud: () => void; onOpenPower: () => void;
    wifiState: WifiState; networkState: string; activeSsid: string | null; apSsid: string | null;
    provisionState: ProvisionState; connectionState: ConnectionState; hostname: string }) {
  return (
    <nav className="navbar navbar-dark" style={{ backgroundColor: 'var(--eb-fg)' }}>
      <div className="container-fluid" style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center' }}>
        <NavLink className="navbar-brand mb-0" to="/" style={{ justifySelf: 'start' }}>
          <img src="/theme/logo/logo.svg" alt="Edgeberry" height="28" />
        </NavLink>
        <span className="d-none d-sm-block fw-semibold text-truncate" style={{ color: 'rgba(255,255,255,0.75)', fontSize: '0.9rem', maxWidth: 240, textAlign: 'center' }}>
          {hostname}
        </span>
        <div className="d-flex align-items-center gap-1" style={{ justifySelf: 'end' }}>
          <button
            className="btn btn-sm d-flex align-items-center"
            style={{ lineHeight: 1, background: 'none', border: 'none', padding: '0.25rem 0.4rem' }}
            onClick={onOpenNetwork}
            title="Network"
          >
            <NetworkIcon wifi={wifiState} network={networkState} ssid={activeSsid} apSsid={apSsid} />
          </button>
          <button
            className="btn btn-sm d-flex align-items-center"
            style={{ lineHeight: 1, background: 'none', border: 'none', padding: '0.25rem 0.4rem' }}
            onClick={onOpenCloud}
          >
            <CloudIcon provision={provisionState} connection={connectionState} />
          </button>
          <NavMenu onOpenTerminal={onOpenTerminal} onOpenPower={onOpenPower} />
        </div>
      </div>
    </nav>
  )
}

function CloudModal({ onReady }: { onReady: (show: () => void) => void }) {
  const [open, setOpen] = useState(false)
  const modalRef        = useRef<HTMLDivElement>(null)
  const modalInstance   = useRef<Modal | null>(null)

  useEffect(() => {
    const el = modalRef.current
    if (!el) return
    const instance = new Modal(el)
    modalInstance.current = instance
    onReady(() => instance.show())
    const show = () => setOpen(true)
    const hide = () => setOpen(false)
    el.addEventListener('shown.bs.modal', show)
    el.addEventListener('hidden.bs.modal', hide)
    return () => {
      el.removeEventListener('shown.bs.modal', show)
      el.removeEventListener('hidden.bs.modal', hide)
      instance.dispose()
      modalInstance.current = null
    }
  }, [])

  return (
    <div ref={modalRef} className="modal fade" tabIndex={-1} aria-hidden="true">
      <div className="modal-dialog modal-fullscreen">
        <div className="modal-content" style={{ background: 'var(--eb-bg)', border: 'none' }}>
          <div className="modal-header" style={{ background: 'var(--eb-fg)', border: 'none', padding: '0.5rem 1rem' }}>
            <span className="modal-title fw-semibold" style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.9rem' }}>
              <i className="fa-solid fa-cloud me-2" style={{ color: 'var(--eb-accent)' }} />Cloud Connection
            </span>
            <button type="button" className="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close" />
          </div>
          <div className="modal-body" style={{ overflow: 'auto' }}>
            {open && <Placeholder title="Cloud Connection" />}
          </div>
        </div>
      </div>
    </div>
  )
}

function PowerModal({ onReady }: { onReady: (show: () => void) => void }) {
  const modalRef      = useRef<HTMLDivElement>(null)
  const modalInstance = useRef<Modal | null>(null)
  const [busy, setBusy] = useState<'reboot' | 'shutdown' | null>(null)

  useEffect(() => {
    const el = modalRef.current
    if (!el) return
    const instance = new Modal(el)
    modalInstance.current = instance
    onReady(() => instance.show())
    return () => { instance.dispose(); modalInstance.current = null }
  }, [])

  async function trigger(action: 'reboot' | 'shutdown') {
    setBusy(action)
    await fetch(`/api/system/${action}`, { method: 'POST' }).catch(() => {})
    modalInstance.current?.hide()
    setBusy(null)
  }

  return (
    <div ref={modalRef} className="modal fade" tabIndex={-1} aria-hidden="true">
      <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: 340 }}>
        <div className="modal-content" style={{ background: 'var(--eb-bg)', border: '1px solid var(--eb-line)' }}>
          <div className="modal-header" style={{ background: 'var(--eb-fg)', border: 'none', padding: '0.5rem 1rem' }}>
            <span className="modal-title fw-semibold" style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.9rem' }}>
              <i className="fa-solid fa-power-off me-2" style={{ color: 'var(--eb-accent)' }} />Power
            </span>
            <button type="button" className="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close" />
          </div>
          <div className="modal-body d-flex flex-column gap-2 p-3">
            <button
              className="btn btn-outline-warning w-100 d-flex align-items-center gap-2"
              onClick={() => trigger('reboot')}
              disabled={busy !== null}
            >
              <i className="fa-solid fa-rotate-right" />
              {busy === 'reboot' ? 'Rebooting…' : 'Reboot'}
            </button>
            <button
              className="btn btn-outline-danger w-100 d-flex align-items-center gap-2"
              onClick={() => trigger('shutdown')}
              disabled={busy !== null}
            >
              <i className="fa-solid fa-power-off" />
              {busy === 'shutdown' ? 'Shutting down…' : 'Shut down'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function NetworkModal({ onReady }: { onReady: (show: () => void) => void }) {
  const [open, setOpen] = useState(false)
  const modalRef        = useRef<HTMLDivElement>(null)
  const modalInstance   = useRef<Modal | null>(null)

  useEffect(() => {
    const el = modalRef.current
    if (!el) return
    const instance = new Modal(el)
    modalInstance.current = instance
    onReady(() => instance.show())
    const show = () => setOpen(true)
    const hide = () => setOpen(false)
    el.addEventListener('shown.bs.modal', show)
    el.addEventListener('hidden.bs.modal', hide)
    return () => {
      el.removeEventListener('shown.bs.modal', show)
      el.removeEventListener('hidden.bs.modal', hide)
      instance.dispose()
      modalInstance.current = null
    }
  }, [])

  return (
    <div ref={modalRef} className="modal fade" tabIndex={-1} aria-hidden="true">
      <div className="modal-dialog modal-fullscreen">
        <div className="modal-content" style={{ background: 'var(--eb-bg)', border: 'none' }}>
          <div className="modal-header" style={{ background: 'var(--eb-fg)', border: 'none', padding: '0.5rem 1rem' }}>
            <span className="modal-title fw-semibold" style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.9rem' }}>
              <i className="fa-solid fa-wifi me-2" style={{ color: 'var(--eb-accent)' }} />Network
            </span>
            <button type="button" className="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close" />
          </div>
          <div className="modal-body" style={{ overflow: 'auto' }}>
            {open && <Network />}
          </div>
        </div>
      </div>
    </div>
  )
}

function TerminalModal({ onReady }: { onReady: (show: () => void) => void }) {
  const [open, setOpen]   = useState(false)
  const modalRef          = useRef<HTMLDivElement>(null)
  const modalInstance     = useRef<Modal | null>(null)

  useEffect(() => {
    const el = modalRef.current
    if (!el) return
    const instance = new Modal(el)
    modalInstance.current = instance
    onReady(() => instance.show())
    const show = () => setOpen(true)
    const hide = () => setOpen(false)
    el.addEventListener('shown.bs.modal', show)
    el.addEventListener('hidden.bs.modal', hide)
    return () => {
      el.removeEventListener('shown.bs.modal', show)
      el.removeEventListener('hidden.bs.modal', hide)
      instance.dispose()
      modalInstance.current = null
    }
  }, [])

  function closeModal() {
    modalInstance.current?.hide()
  }

  return (
    <div ref={modalRef} className="modal fade" id="terminalModal" tabIndex={-1} aria-labelledby="terminalModalLabel" aria-hidden="true">
      <div className="modal-dialog modal-fullscreen">
        <div className="modal-content" style={{ background: '#0d0d0d', border: 'none' }}>
          <div className="modal-header" style={{ background: 'var(--eb-fg)', border: 'none', padding: '0.5rem 1rem' }}>
            <span className="modal-title fw-semibold" id="terminalModalLabel" style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.9rem' }}>
              <i className="fa-solid fa-terminal me-2" style={{ color: 'var(--eb-accent)' }} />Terminal
            </span>
            <button type="button" className="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close" />
          </div>
          <div className="modal-body p-0" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {open && <TerminalPage onRequestClose={closeModal} />}
          </div>
        </div>
      </div>
    </div>
  )
}


function Home() {
  const [name, setName] = useState<string>('—')
  const [status, setStatus] = useState<string>('—')

  useEffect(() => {
    fetch('/api/state')
      .then(r => r.json())
      .then(data => {
        setName(data?.system?.name ?? data?.system?.board ?? '—')
        setStatus(data?.system?.state ?? '—')
      })
      .catch(() => setStatus('unreachable'))
  }, [])

  return (
    <>
      <h1 className="h4">{name}</h1>
      <p className="text-muted">{status}</p>
    </>
  )
}

function Placeholder({ title }: { title: string }) {
  return (
    <>
      <h1 className="h4">{title}</h1>
      <p className="text-muted">Coming soon.</p>
    </>
  )
}

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
  const [hostname,        setHostname]        = useState<string>('')

  useEffect(() => { if (hostname) document.title = hostname }, [hostname])

  useEffect(() => {
    const poll = () => {
      fetch('/api/state')
        .then(r => r.json())
        .then(data => {
          setWifiState(data?.connection?.wifi ?? 'unknown')
          setNetworkState(data?.connection?.network ?? 'unknown')
          setProvisionState(data?.connection?.provision ?? 'unknown')
          setConnectionState(data?.connection?.connection ?? 'unknown')
          setHostname(data?.system?.hostname ?? '')
          setApSsid(data?.system?.apSsid ?? null)
        })
        .catch(() => {})
      fetch('/api/network/wifi/active')
        .then(r => r.json())
        .then(data => setActiveSsid(data?.ssid ?? null))
        .catch(() => {})
    }
    poll()
    const id = setInterval(poll, 10000)
    return () => clearInterval(id)
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
        hostname={hostname}
      />
      <CloudModal    onReady={(fn) => { openCloud.current    = fn }} />
      <PowerModal    onReady={(fn) => { openPower.current    = fn }} />
      <NetworkModal  onReady={(fn) => { openNetwork.current  = fn }} />
      <TerminalModal onReady={(fn) => { openTerminal.current = fn }} />
      <div style={{ height: 'calc(100vh - 56px)' }}>
        <main style={{ overflow: 'auto', height: '100%', display: 'flex', flexDirection: 'column' }}>
          <Routes>
            {/* In AP mode the device is unconfigured or being reconfigured, and
                the captive portal drops the user on '/'. Land them on the
                network view so the setup path and the button/toggle path all
                arrive at the same screen. */}
            <Route path="/" element={wifiState === 'ap_mode' ? <div className="p-4"><Network /></div> : <ApplicationPage />} />
            <Route path="/network" element={<div className="p-4"><Network /></div>} />
            <Route path="/cloud" element={<div className="p-4"><Placeholder title="Cloud Connection" /></div>} />
            <Route path="*" element={<div className="p-4"><Home /></div>} />
          </Routes>
        </main>
      </div>
    </>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  )
}

export default App
