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

      {open && <IpConfigPanel ssid={ap.ssid} onSaved={onRefresh} />}
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
  const [wifi,     setWifi]     = useState<WifiData | null>(null)
  const [scanning, setScanning] = useState(false)
  const [error,    setError]    = useState<string | null>(null)

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
    </>
  )
}
