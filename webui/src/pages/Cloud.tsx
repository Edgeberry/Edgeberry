import { useEffect, useState } from 'react'

/* ── Types ─────────────────────────────────────────────────── */

type CertificateInfo = {
  present:        boolean
  subject?:       string
  issuer?:        string
  notAfter?:      string
  expired?:       boolean
  daysRemaining?: number
}

type CloudStatus = {
  hostName:        string | null
  deviceId:        string | null
  configured:      boolean
  provisioned:     boolean
  provisionState:  string
  connectionState: string
  networkState:    string
  certificate:     CertificateInfo
}

/* ── Helpers ────────────────────────────────────────────────── */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-uppercase fw-semibold mb-2" style={{ fontSize: '0.7rem', letterSpacing: '0.1em', color: 'var(--eb-accent)' }}>
      {children}
    </div>
  )
}

function Field({ label, value, mono = true }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="d-flex gap-3 py-1" style={{ fontSize: '0.85rem' }}>
      <span className="text-muted" style={{ minWidth: 130, flexShrink: 0 }}>{label}</span>
      <span style={{ fontFamily: mono ? 'monospace' : undefined, wordBreak: 'break-all' }}>{value}</span>
    </div>
  )
}

/* Connection is the headline: everything else on this page exists to explain
   why it is not 'connected'. */
function StatusBadge({ status }: { status: CloudStatus }) {
  const { connectionState, provisionState, networkState, provisioned } = status

  let color = 'var(--eb-line)'
  let text  = 'Unknown'
  let note  = ''

  if (!status.configured) {
    text = 'Not configured'
    note = 'No Device Hub has been set up on this device yet.'
  } else if (connectionState === 'connected') {
    color = 'var(--eb-ok)';    text = 'Connected'
  } else if (connectionState === 'connecting' || provisionState === 'provisioning') {
    color = 'var(--eb-warn)';  text = provisionState === 'provisioning' ? 'Provisioning…' : 'Connecting…'
  } else if (networkState !== 'connected') {
    color = 'var(--eb-fault)'; text = 'Disconnected'
    note  = 'The device has no network connection.'
  } else if (!provisioned) {
    color = 'var(--eb-warn)';  text = 'Not provisioned'
    note  = 'The device has not yet received its certificate from the hub.'
  } else {
    color = 'var(--eb-fault)'; text = 'Disconnected'
  }

  return (
    <div className="mb-2">
      <div className="d-flex align-items-center gap-2">
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
        <span className="fw-semibold">{text}</span>
      </div>
      {note && <div className="text-muted mt-1" style={{ fontSize: '0.8rem' }}>{note}</div>}
    </div>
  )
}

function CertificatePanel({ cert }: { cert: CertificateInfo }) {
  if (!cert.present)
    return <p className="text-muted" style={{ fontSize: '0.85rem' }}>No device certificate — the device is not provisioned.</p>

  const expiringSoon = cert.daysRemaining !== undefined && cert.daysRemaining >= 0 && cert.daysRemaining < 30

  return (
    <>
      {cert.subject  && <Field label="Subject"   value={cert.subject} />}
      {cert.issuer   && <Field label="Issuer"    value={cert.issuer} />}
      {cert.notAfter && (
        <Field
          label="Expires"
          value={
            <span style={{ color: cert.expired ? 'var(--eb-fault)' : expiringSoon ? 'var(--eb-warn)' : undefined }}>
              {new Date(cert.notAfter).toLocaleString()}
              {cert.expired
                ? ' — expired'
                : cert.daysRemaining !== undefined && ` — ${cert.daysRemaining} days left`}
            </span>
          }
        />
      )}
      {cert.expired && (
        <p className="mt-2 mb-0" style={{ fontSize: '0.8rem', color: 'var(--eb-fault)' }}>
          An expired certificate is rejected by the hub. Provision again to obtain a new one.
        </p>
      )}
    </>
  )
}

/* ── Device Hub configuration ───────────────────────────────── */

function HubConfig({ status, onDone }: { status: CloudStatus; onDone: () => void }) {
  const [host,  setHost]  = useState(status.hostName ?? '')
  const [busy,  setBusy]  = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok,    setOk]    = useState(false)

  async function provision() {
    setBusy(true); setError(null); setOk(false)
    try {
      const r = await fetch('/api/cloud/provision', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostName: host.trim() }),
      })
      const d = await r.json()
      if (r.ok) { setOk(true); onDone() }
      else setError(d.error ?? 'Provisioning failed.')
    } catch {
      setError('Request failed.')
    }
    setBusy(false)
  }

  return (
    <>
      <div className="input-group input-group-sm mb-2" style={{ maxWidth: 460 }}>
        <span className="input-group-text" style={{ fontSize: '0.8rem' }}>Host</span>
        <input
          className="form-control"
          style={{ fontFamily: 'monospace' }}
          value={host}
          placeholder="devicehub.example.com"
          disabled={busy}
          onChange={e => setHost(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && host.trim()) provision() }}
        />
      </div>

      <button className="btn btn-sm btn-primary" onClick={provision} disabled={busy || !host.trim()}>
        {busy ? 'Provisioning…' : status.provisioned ? 'Provision again' : 'Connect to Device Hub'}
      </button>

      {busy && (
        <p className="text-muted mt-2 mb-0" style={{ fontSize: '0.8rem' }}>
          Fetching provisioning certificates and requesting a device certificate.
          This can take up to a minute if the hub is slow to answer.
        </p>
      )}
      {ok && !busy && (
        <p className="text-success mt-2 mb-0" style={{ fontSize: '0.8rem' }}>
          Provisioned. The device is connecting to the hub.
        </p>
      )}
      {error && <p className="text-danger mt-2 mb-0" style={{ fontSize: '0.8rem' }}>{error}</p>}

      {status.provisioned && !busy && (
        <p className="text-muted mt-2 mb-0" style={{ fontSize: '0.8rem' }}>
          Provisioning again discards the current device certificate and requests a new one.
        </p>
      )}
    </>
  )
}

/* ── Actions ────────────────────────────────────────────────── */

function Actions({ status, onDone }: { status: CloudStatus; onDone: () => void }) {
  const [busy,    setBusy]    = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  async function post(path: string, label: string) {
    setBusy(label); setError(null); setConfirm(false)
    try {
      const r = await fetch(path, { method: 'POST' })
      const d = await r.json()
      if (!r.ok) setError(d.error ?? 'Failed.')
      else onDone()
    } catch {
      setError('Request failed.')
    }
    setBusy(null)
  }

  return (
    <>
      <div className="d-flex gap-2 flex-wrap">
        <button
          className="btn btn-sm btn-outline-secondary"
          onClick={() => post('/api/cloud/reconnect', 'reconnect')}
          disabled={busy !== null || !status.configured}
        >
          {busy === 'reconnect' ? 'Reconnecting…' : 'Reconnect'}
        </button>
        <button
          className="btn btn-sm btn-outline-danger"
          onClick={() => setConfirm(true)}
          disabled={busy !== null || !status.provisioned}
        >
          Forget connection
        </button>
      </div>

      {confirm && (
        <div className="mt-3 p-3" style={{ background: 'rgba(0,0,0,0.03)', borderRadius: 8 }}>
          <p className="mb-2" style={{ fontSize: '0.85rem' }}>
            This deletes the device certificate. The device will provision again against{' '}
            <strong style={{ fontFamily: 'monospace' }}>{status.hostName ?? 'the configured hub'}</strong> on the next
            connection attempt.
          </p>
          <div className="d-flex gap-2">
            <button className="btn btn-sm btn-danger" onClick={() => post('/api/cloud/reset', 'reset')}>
              {busy === 'reset' ? 'Working…' : 'Forget'}
            </button>
            <button className="btn btn-sm btn-outline-secondary" onClick={() => setConfirm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {error && <p className="text-danger mt-2 mb-0" style={{ fontSize: '0.8rem' }}>{error}</p>}
    </>
  )
}

/* ── Main page ──────────────────────────────────────────────── */

export default function Cloud() {
  const [status, setStatus] = useState<CloudStatus | null>(null)
  const [failed, setFailed] = useState(false)

  function load() {
    fetch('/api/cloud')
      .then(r => r.json())
      .then((d: CloudStatus) => { setStatus(d); setFailed(false) })
      .catch(() => setFailed(true))
  }

  // Provisioning and reconnection both resolve asynchronously on the device,
  // so poll rather than relying on the action's own response.
  useEffect(() => {
    load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [])

  if (failed && !status)
    return <p className="text-danger" style={{ fontSize: '0.875rem' }}>Could not read cloud status.</p>

  if (!status) return null

  return (
    <>
      <h1 className="h4 mb-4">Cloud Connection</h1>

      <div className="mb-4">
        <SectionLabel>Status</SectionLabel>
        <StatusBadge status={status} />
      </div>

      <div className="mb-4">
        <SectionLabel>Device Hub</SectionLabel>
        <Field label="Host"      value={status.hostName ?? '—'} />
        <Field label="Device ID" value={status.deviceId ?? '—'} />
      </div>

      <div className="mb-4">
        <SectionLabel>Device certificate</SectionLabel>
        <CertificatePanel cert={status.certificate} />
      </div>

      <div className="mb-4">
        <SectionLabel>Configuration</SectionLabel>
        <HubConfig status={status} onDone={load} />
      </div>

      <div className="mb-4">
        <SectionLabel>Actions</SectionLabel>
        <Actions status={status} onDone={load} />
      </div>
    </>
  )
}
