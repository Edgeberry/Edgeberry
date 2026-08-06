import { useEffect, useState } from 'react'
import {
  api, ApiError,
  type AccessPoint, type ApStatus, type IpMode, type NetInterface, type WifiData,
} from '../api'
import { SectionLabel, InsetPanel, SignalBars } from '../components/ui'

const AP_ADDRESS = '10.42.0.1'

/** Which way the device is about to move. Both directions drop the connection
 *  this page is served over, so each needs its own instructions. */
type Transition = { to: 'ap' | 'station'; ssid: string | null }

type IpForm = {
  mode:    IpMode
  address: string
  prefix:  string
  gateway: string
  dns:     string
}

/* ── AP mode transition instructions ────────────────────────── */

/* A fixed overlay rather than a Bootstrap modal: this component mounts inside
   the fullscreen Network modal, and nested Bootstrap modals fight over backdrop
   and scroll state. It must also survive the polling in AppShell beginning to
   fail — by the time it is visible, the device is already leaving the network
   this page came from. */
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
        <div
          className="d-flex align-items-center gap-2 px-3 py-2"
          style={{ background: 'var(--eb-navbar-bg)', borderRadius: '8px 8px 0 0' }}
        >
          <i className="fa-solid fa-wifi" style={{ color: 'var(--eb-accent)' }} />
          <span className="fw-semibold" style={{ color: 'var(--eb-navbar-fg)', fontSize: '0.9rem' }}>
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

/* ── Access point switch ────────────────────────────────────── */

function ApSection({ onTransition }: { onTransition: (t: Transition) => void }) {
  const [ap,      setAp]      = useState<ApStatus | null>(null)
  const [pending, setPending] = useState<boolean | null>(null)
  const [busy,    setBusy]    = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => { api.network.getAp().then(setAp).catch(() => {}) }, [])

  // Locked on: in AP mode with nowhere to return to. Turning it off would leave
  // the device unreachable over the network and over this interface.
  const locked = ap !== null && ap.active && !ap.canExit

  async function apply( enabled:boolean ) {
    setBusy(true); setError(null); setPending(null)
    try {
      await api.network.setAp(enabled)
      setAp(current => (current ? { ...current, active: enabled } : current))
      onTransition({ to: enabled ? 'ap' : 'station', ssid: enabled ? (ap?.ssid ?? null) : null })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Request failed.')
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
          {ap.ssid && (
            <span className="text-muted ms-2" style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
              {ap.ssid}
            </span>
          )}
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
        <InsetPanel>
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
        </InsetPanel>
      )}
    </div>
  )
}

/* ── IP configuration ───────────────────────────────────────── */

function IpConfigPanel({ ssid, onSaved }: { ssid: string; onSaved: () => void }) {
  const [form,   setForm]   = useState<IpForm>({ mode: 'auto', address: '', prefix: '24', gateway: '', dns: '' })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  function field( key:keyof IpForm, label:string, placeholder:string ) {
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
    setSaving(true); setMessage(null)
    try {
      await api.network.setIpConfig({
        ssid,
        mode:    form.mode,
        ...(form.mode === 'manual' ? {
          address: form.address,
          prefix:  Number(form.prefix),
          gateway: form.gateway,
          dns:     form.dns,
        } : {}),
      })
      setMessage({ ok: true, text: 'Saved.' })
      onSaved()
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : 'Request failed.' })
    }
    setSaving(false)
  }

  return (
    <InsetPanel>
      <div className="mb-3">
        <SectionLabel>IP configuration</SectionLabel>
        <div className="d-flex gap-3">
          {(['auto', 'manual'] as const).map(mode => (
            <div key={mode} className="form-check">
              <input
                className="form-check-input" type="radio" id={`ip-${mode}-${ssid}`}
                checked={form.mode === mode}
                onChange={() => setForm(f => ({ ...f, mode }))}
                disabled={saving}
              />
              <label className="form-check-label" htmlFor={`ip-${mode}-${ssid}`}>
                {mode === 'auto' ? 'DHCP' : 'Static'}
              </label>
            </div>
          ))}
        </div>
      </div>

      {field('address', 'Address',      '192.168.1.100')}
      {field('prefix',  'Prefix length','24')}
      {field('gateway', 'Gateway',      '192.168.1.1')}
      {field('dns',     'DNS servers',  '1.1.1.1, 8.8.8.8')}

      <div className="d-flex align-items-center gap-3 mt-3">
        <button className="btn btn-sm btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {message && (
          <span className={message.ok ? 'text-success' : 'text-danger'} style={{ fontSize: '0.8rem' }}>
            {message.text}
          </span>
        )}
      </div>
    </InsetPanel>
  )
}

/* ── Joining a network ──────────────────────────────────────── */

/* When the captive portal is active, a successful join also tears down the
   access point on the device side — the same call therefore serves both the
   setup wizard and an ordinary "switch networks" from the dashboard. */
function WifiJoinPanel({ ap, onJoined }: { ap: AccessPoint; onJoined: () => void }) {
  const [passphrase, setPassphrase] = useState('')
  const [reveal,     setReveal]     = useState(false)
  const [state,      setState]      = useState<'idle' | 'connecting' | 'ok' | 'fail'>('idle')

  async function connect() {
    setState('connecting')
    try {
      const { success } = await api.network.join(ap.ssid, ap.secured ? passphrase : '')
      if (success) { setState('ok'); onJoined() } else setState('fail')
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
    <InsetPanel>
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
    </InsetPanel>
  )
}

/* ── Network list ───────────────────────────────────────────── */

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
        <SignalBars strength={ap.strength} />
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
          setWifiIpConfig() rejects an SSID with no saved profile, so an unsaved
          network gets the join panel instead. */}
      {open && (isSaved
        ? <IpConfigPanel ssid={ap.ssid} onSaved={onRefresh} />
        : <WifiJoinPanel ap={ap} onJoined={onRefresh} />)}
    </div>
  )
}

function Interfaces() {
  const [interfaces, setInterfaces] = useState<NetInterface[]>([])

  useEffect(() => {
    api.network.getInterfaces()
      .then(list => setInterfaces(list.filter(i => !i.addresses.every(a => a.internal))))
      .catch(() => {})
  }, [])

  if (interfaces.length === 0) return null

  return (
    <div className="mb-4">
      <SectionLabel>Interfaces</SectionLabel>
      {interfaces.map(iface => (
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

/* ── Page ───────────────────────────────────────────────────── */

export default function Network() {
  const [wifi,       setWifi]       = useState<WifiData | null>(null)
  const [scanning,   setScanning]   = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [transition, setTransition] = useState<Transition | null>(null)

  useEffect(() => { load() }, [])

  function load() {
    setScanning(true); setError(null)
    api.network.getWifi()
      .then(data => { setWifi(data); setScanning(false) })
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

      {wifi?.available.map(ap => (
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
