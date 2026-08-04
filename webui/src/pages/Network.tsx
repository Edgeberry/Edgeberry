import { useEffect, useState } from 'react'

/* ── Types ─────────────────────────────────────────────────── */

type Address = { address: string; family: string; mac: string; internal: boolean; cidr: string | null }
type NetInterface = { name: string; addresses: Address[] }
type SavedNetwork = { ssid: string; autoconnect: boolean }
type AccessPoint  = { ssid: string; strength: number; frequency: number; secured: boolean }

type WifiData = {
  available: AccessPoint[]
  saved:     SavedNetwork[]
  active:    string | null
}

type IpForm = {
  mode:    'auto' | 'manual'
  address: string
  prefix:  string
  gateway: string
  dns:     string
}

/* canExit is false when no real (non-AP) network profile is saved — leaving
   AP mode would strand the device, so the switch locks in the on position. */
type ApStatus = { active: boolean; ssid: string | null; canExit: boolean }

/* Which way the device is about to move. Both directions drop the connection
   this page is served over, so each needs its own instructions. */
type Transition = { to: 'ap' | 'station'; ssid: string | null }

const AP_ADDRESS = '10.42.0.1'

/* ── Helpers ────────────────────────────────────────────────── */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-uppercase fw-semibold mb-2" style={{ fontSize: '0.7rem', letterSpacing: '0.1em', color: 'var(--eb-accent)' }}>
      {children}
    </div>
  )
}

function SignalDots({ strength }: { strength: number }) {
  const bars = Math.round((strength / 100) * 4)
  const color = strength >= 70 ? 'var(--eb-ok)' : strength >= 40 ? 'var(--eb-warn)' : 'var(--eb-fault)'
  return (
    <span style={{ color, fontFamily: 'monospace', fontSize: '0.8rem', letterSpacing: '-1px' }}>
      {'▂▄▆█'.split('').map((c, i) => (
        <span key={i} style={{ opacity: i < bars ? 1 : 0.2 }}>{c}</span>
      ))}
    </span>
  )
}

/* ── AP mode transition instructions ────────────────────────── */

/* Rendered as a fixed overlay rather than a Bootstrap modal: this component
   mounts inside the fullscreen Network modal, and nesting Bootstrap modals
   fights over backdrop and scroll state. It must also survive the polling in
   AppShell starting to fail — by the time it is visible the device is already
   leaving the network this page came from. */
function TransitionOverlay({ t, onClose }: { t: Transition; onClose: () => void }) {
  const toAp = t.to === 'ap'
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 2000, padding: '1rem',
        background: 'rgba(0,0,0,0.75)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div style={{ background: 'var(--eb-bg)', border: '1px solid var(--eb-line)', borderRadius: 8, maxWidth: 420, width: '100%' }}>
        <div className="d-flex align-items-center gap-2 px-3 py-2" style={{ background: 'var(--eb-fg)', borderRadius: '8px 8px 0 0' }}>
          <i className="fa-solid fa-wifi" style={{ color: 'var(--eb-accent)' }} />
          <span className="fw-semibold" style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.9rem' }}>
            {toAp ? 'Access Point mode activated' : 'Leaving Access Point mode'}
          </span>
        </div>
        <div className="p-3">
          {toAp ? (
            <>
              <p style={{ fontSize: '0.9rem' }}>
                Connect to <strong style={{ fontFamily: 'monospace' }}>{t.ssid ?? 'the device access point'}</strong>{' '}
                and open <strong style={{ fontFamily: 'monospace' }}>http://{AP_ADDRESS}</strong> to continue setup.
              </p>
              <p className="text-muted mb-0" style={{ fontSize: '0.8rem' }}>
                The device has left your network. This page will not refresh.
              </p>
            </>
          ) : (
            <>
              <p style={{ fontSize: '0.9rem' }}>
                The device is rejoining <strong style={{ fontFamily: 'monospace' }}>{t.ssid ?? 'its saved network'}</strong>.
                Reconnect your computer to that network to continue.
              </p>
              <p className="text-muted mb-0" style={{ fontSize: '0.8rem' }}>
                The access point is shutting down. This page will not refresh.
              </p>
            </>
          )}
          <button className="btn btn-sm btn-outline-secondary mt-3" onClick={onClose}>Dismiss</button>
        </div>
      </div>
    </div>
  )
}

/* ── AP mode switch ─────────────────────────────────────────── */

function ApSection({ onTransition }: { onTransition: (t: Transition) => void }) {
  const [ap,      setAp]      = useState<ApStatus | null>(null)
  const [pending, setPending] = useState<boolean | null>(null)
  const [busy,    setBusy]    = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/network/ap').then(r => r.json()).then(setAp).catch(() => {})
  }, [])

  // Locked on: in AP mode with nowhere to return to. Turning it off would
  // leave the device unreachable over the network and over this UI.
  const locked = ap !== null && ap.active && !ap.canExit

  async function apply(enabled: boolean) {
    setBusy(true); setError(null); setPending(null)
    try {
      const r = await fetch('/api/network/ap', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      const d = await r.json()
      if (!r.ok) { setError(d.error ?? 'Failed.'); setBusy(false); return }
      setAp(a => (a ? { ...a, active: enabled } : a))
      onTransition({ to: enabled ? 'ap' : 'station', ssid: enabled ? (ap?.ssid ?? null) : null })
    } catch {
      setError('Request failed.')
    }
    setBusy(false)
  }

  if (!ap) return null

  return (
    <div className="mb-4">
      <SectionLabel>Access point</SectionLabel>

      <div className="form-check form-switch d-flex align-items-center gap-2 ps-0">
        <input
          className="form-check-input m-0"
          type="checkbox"
          role="switch"
          id="ap-switch"
          style={{ marginLeft: 0 }}
          checked={ap.active}
          disabled={locked || busy || pending !== null}
          onChange={() => setPending(!ap.active)}
        />
        <label className="form-check-label" htmlFor="ap-switch" style={{ fontSize: '0.9rem' }}>
          {ap.active ? 'Active' : 'Off'}
          {ap.ssid && <span className="text-muted ms-2" style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{ap.ssid}</span>}
        </label>
      </div>

      {locked && (
        <p className="text-muted mt-2 mb-0" style={{ fontSize: '0.8rem' }}>
          No wireless network is configured, so access point mode cannot be switched off.
          Join a network below first.
        </p>
      )}

      {error && <p className="text-danger mt-2 mb-0" style={{ fontSize: '0.8rem' }}>{error}</p>}

      {pending !== null && (
        <div className="mt-3 p-3" style={{ background: 'rgba(0,0,0,0.03)', borderRadius: 8 }}>
          <p className="mb-2" style={{ fontSize: '0.85rem' }}>
            {pending
              ? <>The device will leave your network and broadcast <strong style={{ fontFamily: 'monospace' }}>{ap.ssid ?? 'its own access point'}</strong>. You will lose this page.</>
              : <>The device will shut down the access point and rejoin its saved network. You will lose this page.</>}
          </p>
          <div className="d-flex gap-2">
            <button className="btn btn-sm btn-primary" onClick={() => apply(pending)} disabled={busy}>
              {busy ? 'Working…' : 'Continue'}
            </button>
            <button className="btn btn-sm btn-outline-secondary" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── IP config panel ────────────────────────────────────────── */

function IpConfigPanel({ ssid, onSaved }: { ssid: string; onSaved: () => void }) {
  const [form, setForm] = useState<IpForm>({ mode: 'auto', address: '', prefix: '24', gateway: '', dns: '' })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg]     = useState<{ ok: boolean; text: string } | null>(null)

  function field(key: keyof IpForm, label: string, placeholder: string) {
    return (
      <div className="mb-2">
        <label className="form-label mb-1" style={{ fontSize: '0.8rem', fontFamily: 'monospace' }}>{label}</label>
        <input
          className="form-control form-control-sm"
          style={{ fontFamily: 'monospace' }}
          value={form[key]}
          placeholder={placeholder}
          onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
          disabled={form.mode === 'auto' || saving}
        />
      </div>
    )
  }

  async function save() {
    setSaving(true); setMsg(null)
    const body: any = { ssid, mode: form.mode }
    if (form.mode === 'manual') {
      body.address = form.address
      body.prefix  = Number(form.prefix)
      body.gateway = form.gateway
      body.dns     = form.dns
    }
    try {
      const r = await fetch('/api/network/wifi/ipconfig', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const d = await r.json()
      if (d.ok) { setMsg({ ok: true, text: 'Saved.' }); onSaved() }
      else setMsg({ ok: false, text: d.error ?? 'Failed.' })
    } catch { setMsg({ ok: false, text: 'Request failed.' }) }
    setSaving(false)
  }

  return (
    <div className="mt-3 p-3" style={{ background: 'rgba(0,0,0,0.03)', borderRadius: 8, fontFamily: 'monospace', fontSize: '0.875rem' }}>
      <div className="mb-3">
        <SectionLabel>IP configuration</SectionLabel>
        <div className="d-flex gap-3">
          {(['auto', 'manual'] as const).map(m => (
            <div key={m} className="form-check">
              <input className="form-check-input" type="radio" id={`ip-${m}-${ssid}`}
                checked={form.mode === m} onChange={() => setForm(f => ({ ...f, mode: m }))} disabled={saving} />
              <label className="form-check-label" htmlFor={`ip-${m}-${ssid}`}
                style={{ textTransform: 'capitalize' }}>{m === 'auto' ? 'DHCP' : 'Static'}</label>
            </div>
          ))}
        </div>
      </div>
      {field('address', 'Address',     '192.168.1.100')}
      {field('prefix',  'Prefix length','24')}
      {field('gateway', 'Gateway',      '192.168.1.1')}
      {field('dns',     'DNS servers',  '1.1.1.1, 8.8.8.8')}
      <div className="d-flex align-items-center gap-3 mt-3">
        <button className="btn btn-sm btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {msg && <span className={msg.ok ? 'text-success' : 'text-danger'} style={{ fontSize: '0.8rem' }}>{msg.text}</span>}
      </div>
    </div>
  )
}

/* ── WiFi join panel ────────────────────────────────────────── */

/* Posts to /provision/connect, which is mounted unconditionally by
   CaptivePortal — so the same panel serves both the AP-mode setup wizard and
   an ordinary "switch networks" action from the dashboard. When the portal is
   active a successful join also tears down the AP on the device side. */
function WifiJoinPanel({ ap, onJoined }: { ap: AccessPoint; onJoined: () => void }) {
  const [passphrase, setPassphrase] = useState('')
  const [reveal,     setReveal]     = useState(false)
  const [state,      setState]      = useState<'idle' | 'connecting' | 'ok' | 'fail'>('idle')

  async function connect() {
    setState('connecting')
    try {
      const r = await fetch('/provision/connect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ssid: ap.ssid, passphrase: ap.secured ? passphrase : '' }),
      })
      const d = await r.json()
      if (d.success) { setState('ok'); onJoined() } else setState('fail')
    } catch {
      setState('fail')
    }
  }

  if (state === 'connecting')
    return <div className="mt-3 p-3 text-muted" style={{ fontSize: '0.85rem' }}>Connecting to {ap.ssid}…</div>

  if (state === 'ok')
    return (
      <div className="mt-3 p-3" style={{ fontSize: '0.85rem' }}>
        <span className="text-success">Connected to {ap.ssid}.</span>
        <div className="text-muted mt-1" style={{ fontSize: '0.8rem' }}>
          If the device was in access point mode it is now leaving it — reconnect your
          computer to your normal network.
        </div>
      </div>
    )

  return (
    <div className="mt-3 p-3" style={{ background: 'rgba(0,0,0,0.03)', borderRadius: 8 }}>
      <SectionLabel>Join network</SectionLabel>
      {ap.secured ? (
        <div className="input-group input-group-sm mb-2">
          <input
            className="form-control"
            style={{ fontFamily: 'monospace' }}
            type={reveal ? 'text' : 'password'}
            value={passphrase}
            placeholder="Password"
            autoComplete="off"
            onChange={e => setPassphrase(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') connect() }}
          />
          <button className="btn btn-outline-secondary" onClick={() => setReveal(v => !v)} type="button">
            {reveal ? 'Hide' : 'Show'}
          </button>
        </div>
      ) : (
        <p className="text-muted" style={{ fontSize: '0.8rem' }}>This is an open network.</p>
      )}
      <div className="d-flex align-items-center gap-3">
        <button className="btn btn-sm btn-primary" onClick={connect} disabled={ap.secured && !passphrase}>
          Connect
        </button>
        {state === 'fail' && (
          <span className="text-danger" style={{ fontSize: '0.8rem' }}>
            Could not connect. Check the password and try again.
          </span>
        )}
      </div>
    </div>
  )
}

/* ── WiFi list row ──────────────────────────────────────────── */

function WifiRow({ ap, isSaved, isActive, onRefresh }: {
  ap: AccessPoint; isSaved: boolean; isActive: boolean; onRefresh: () => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div style={{ borderBottom: '1px solid var(--eb-line)' }}>
      <div
        className="d-flex align-items-center gap-2 py-2 px-1"
        style={{ cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setOpen(o => !o)}
      >
        <SignalDots strength={ap.strength} />
        <span className="flex-grow-1 fw-medium" style={{ fontSize: '0.9rem' }}>
          {isActive && <span className="me-1" style={{ color: 'var(--eb-ok)' }}>✓</span>}
          {ap.ssid}
        </span>
        {ap.secured && <span style={{ fontSize: '0.75rem', color: 'var(--eb-line)' }}>🔒</span>}
        {isSaved && (
          <span className="badge" style={{ fontSize: '0.65rem', background: 'var(--eb-fg)', color: 'var(--eb-bg)' }}>
            saved
          </span>
        )}
        <span style={{ fontSize: '0.7rem', color: 'var(--eb-line)' }}>
          {ap.frequency >= 5000 ? '5 GHz' : '2.4 GHz'}
        </span>
        <span style={{ fontSize: '0.7rem', color: 'var(--eb-line)' }}>{open ? '▲' : '▼'}</span>
      </div>

      {/* IP configuration only applies to a profile that already exists —
          setWifiIpConfig() throws for an SSID with no saved profile, so an
          unsaved network gets the join panel instead. */}
      {open && (isSaved
        ? <IpConfigPanel ssid={ap.ssid} onSaved={onRefresh} />
        : <WifiJoinPanel ap={ap} onJoined={onRefresh} />)}
    </div>
  )
}

/* ── Network interfaces section ─────────────────────────────── */

function Interfaces() {
  const [ifaces, setIfaces] = useState<NetInterface[]>([])

  useEffect(() => {
    fetch('/api/network/interfaces')
      .then(r => r.json())
      .then((d: NetInterface[]) => setIfaces(d.filter(i => !i.addresses.every(a => a.internal))))
      .catch(() => {})
  }, [])

  if (ifaces.length === 0) return null

  return (
    <div className="mb-4">
      <SectionLabel>Interfaces</SectionLabel>
      {ifaces.map(iface => (
        <div key={iface.name} className="mb-2" style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
          <div className="fw-bold">{iface.name}</div>
          {iface.addresses.map((addr, i) => (
            <div key={i} className="text-muted ms-2">
              {addr.family}&nbsp;&nbsp;{addr.cidr ?? addr.address}
              {addr.mac && addr.mac !== '00:00:00:00:00:00' && <span className="ms-3">{addr.mac}</span>}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/* ── Main page ──────────────────────────────────────────────── */

export default function Network() {
  const [wifi,       setWifi]       = useState<WifiData | null>(null)
  const [scanning,   setScanning]   = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [transition, setTransition] = useState<Transition | null>(null)

  useEffect(() => { load() }, [])

  function load() {
    setScanning(true); setError(null)
    fetch('/api/network/wifi')
      .then(r => r.json())
      .then((d: WifiData) => { setWifi(d); setScanning(false) })
      .catch(() => { setError('Scan failed.'); setScanning(false) })
  }

  const savedSsids = new Set((wifi?.saved ?? []).map(s => s.ssid))

  return (
    <>
      <h1 className="h4 mb-4">Network</h1>

      <ApSection onTransition={setTransition} />

      <Interfaces />

      <div className="d-flex align-items-center justify-content-between mb-2">
        <SectionLabel>WiFi</SectionLabel>
        <button className="btn btn-sm btn-outline-secondary" onClick={load} disabled={scanning} title="Scan">
          <i className={`fa-solid fa-rotate${scanning ? ' fa-spin' : ''}`} />
        </button>
      </div>

      {error && <p className="text-danger" style={{ fontSize: '0.875rem' }}>{error}</p>}

      {wifi && wifi.available.length === 0 && (
        <p className="text-muted" style={{ fontSize: '0.875rem' }}>No networks found.</p>
      )}

      {wifi && wifi.available.map(ap => (
        <WifiRow
          key={ap.ssid}
          ap={ap}
          isSaved={savedSsids.has(ap.ssid)}
          isActive={wifi.active === ap.ssid}
          onRefresh={load}
        />
      ))}

      {transition && <TransitionOverlay t={transition} onClose={() => setTransition(null)} />}
    </>
  )
}
