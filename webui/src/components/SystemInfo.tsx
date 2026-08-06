/*
 *  System information
 *
 *  The panel behind the device name in the top bar — what GNOME's "About this
 *  device" shows, for a device with no screen of its own: the machine, the
 *  operating system on it, and the Edgeberry board on its header.
 *
 *  Read-only by design. Everything here is either a constant of the hardware or
 *  a figure you look at once; anything actionable belongs on a page, not in a
 *  dropdown.
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, type SystemInfo } from '../api'

/* ── Formatting ─────────────────────────────────────────────── */

/* Binary units, matching how the rest of the Linux world reports memory and
   disks — a "4 GB" Pi reports 3.9 GiB, and the panel should not disagree with
   free(1) sitting in the terminal next to it. */
function bytes( value:number ):string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let n = value
  let unit = 0
  while (n >= 1024 && unit < units.length - 1) { n /= 1024; unit++ }
  return `${n < 10 && unit > 0 ? n.toFixed(1) : Math.round(n)} ${units[unit]}`
}

/* Coarse on purpose: an uptime is read to answer "did it reboot?", so the
   largest two units carry the whole answer. */
function duration( seconds:number ):string {
  const days    = Math.floor(seconds / 86400)
  const hours   = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  const parts: string[] = []
  if (days)    parts.push(`${days} day${days === 1 ? '' : 's'}`)
  if (hours)   parts.push(`${hours} hour${hours === 1 ? '' : 's'}`)
  if (!days && minutes) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`)
  return parts.length ? parts.join(', ') : 'less than a minute'
}

/* ── Panel ──────────────────────────────────────────────────── */

const LABEL_COLOR = 'rgba(255,255,255,0.55)'
const RULE_COLOR  = 'rgba(255,255,255,0.12)'

/** One label/value line. Renders nothing when the device did not report a value. */
function Row({ label, value, mono = false }: { label: string; value: string | null; mono?: boolean }) {
  if (!value) return null
  return (
    <div className="d-flex gap-3 align-items-baseline" style={{ padding: '0.2rem 0' }}>
      <span style={{ color: LABEL_COLOR, flexShrink: 0 }}>{label}</span>
      <span
        className="ms-auto text-end"
        style={{ fontFamily: mono ? 'monospace' : undefined, wordBreak: 'break-all' }}
      >
        {value}
      </span>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ borderTop: `1px solid ${RULE_COLOR}`, padding: '0.5rem 0.9rem' }}>
      <div
        className="text-uppercase fw-semibold mb-1"
        style={{ fontSize: '0.65rem', letterSpacing: '0.09em', color: 'var(--eb-accent)' }}
      >
        {title}
      </div>
      {children}
    </div>
  )
}

function Panel({ info }: { info: SystemInfo }) {
  const { system, board } = info

  const memory = `${bytes(system.memoryTotal)} · ${bytes(system.memoryFree)} free`
  const disk   = system.diskTotal !== null
    ? `${bytes(system.diskTotal)}${system.diskFree !== null ? ` · ${bytes(system.diskFree)} free` : ''}`
    : null

  return (
    <div style={{ fontSize: '0.78rem', color: 'var(--eb-navbar-fg)' }}>
      {/* Identity block: the same three lines GNOME puts under its logo. */}
      <div className="text-center" style={{ padding: '1rem 0.9rem 0.85rem' }}>
        <img src="/theme/logo/logo.svg" alt="" height="26" className="mb-2" style={{ opacity: 0.9 }} />
        <div className="fw-semibold text-truncate" style={{ fontSize: '0.95rem' }}>{system.hostname}</div>
        {system.model && (
          <div className="text-truncate" style={{ color: LABEL_COLOR, fontSize: '0.75rem' }}>{system.model}</div>
        )}
      </div>

      <Group title="Device">
        <Row label="Model"     value={system.model} />
        <Row label="Processor" value={system.cpu ? `${system.cpu} × ${system.cpuCores}` : `${system.cpuCores} cores`} />
        <Row label="Memory"    value={memory} />
        <Row label="Storage"   value={disk} />
        <Row label="Serial"    value={system.serial} mono />
      </Group>

      <Group title="Operating system">
        <Row label="Name"         value={system.osName} />
        <Row label="Kernel"       value={system.kernel} mono />
        <Row label="Architecture" value={system.architecture} mono />
        <Row label="Uptime"       value={duration(system.uptime)} />
      </Group>

      {/* The board is a separate machine from the host — it can be absent, and
          then this whole section is. */}
      {(board.product || board.uuid) && (
        <Group title="Edgeberry board">
          <Row
            label="Board"
            value={board.product && `${board.product}${board.version ? ` rev ${board.version}` : ''}`}
          />
          <Row label="Vendor"     value={board.vendor} />
          <Row label="Product ID" value={board.id} mono />
          <Row label="UUID"       value={board.uuid} mono />
        </Group>
      )}

      <Group title="Software">
        <Row label="Edgeberry" value={system.version ? `v${system.version}` : null} />
      </Group>
    </div>
  )
}

/* ── Trigger ────────────────────────────────────────────────── */

/**
 * The device name in the top bar, with the system information panel beneath it.
 *
 * The panel is fetched when it opens rather than kept fresh: the live figures
 * (uptime, free memory, free disk) are only meaningful at the moment you look
 * at them, and a closed dropdown has no business polling the device.
 */
export default function SystemInfoMenu({ hostname }: { hostname: string }) {
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [failed, setFailed] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef  = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  const WIDTH = 320

  function toggle() {
    if (open) { setOpen(false); return }

    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      // Centred under the name, but never off the edge on a phone.
      const left = Math.min(
        Math.max(8, rect.left + rect.width / 2 - WIDTH / 2),
        window.innerWidth - WIDTH - 8
      )
      setPos({ top: rect.bottom + 6, left })
    }

    setFailed(false)
    api.system.getInfo().then(setInfo).catch(() => setFailed(true))
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return

    function onMouseDown( event:MouseEvent ) {
      const target = event.target as Node
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKeyDown( event:KeyboardEvent ) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // Into document.body for the same reason as the overflow menu: the navbar is
  // its own stacking context and would clip the panel.
  const panel = open ? createPortal(
    <div
      ref={panelRef}
      style={{
        position: 'fixed', top: pos.top, left: pos.left, width: WIDTH, zIndex: 99999,
        backgroundColor: 'var(--eb-navbar-bg)', border: `1px solid ${RULE_COLOR}`,
        borderRadius: '0.5rem', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        maxHeight: 'calc(100vh - 80px)', overflowY: 'auto',
      }}
    >
      {info
        ? <Panel info={info} />
        : (
          <div className="text-center" style={{ padding: '1.25rem 0.9rem', fontSize: '0.78rem', color: LABEL_COLOR }}>
            {failed ? 'Could not read system information.' : 'Reading system information…'}
          </div>
        )}
    </div>,
    document.body
  ) : null

  return (
    <>
      <button
        ref={buttonRef}
        className="d-none d-sm-flex align-items-center fw-semibold text-truncate"
        style={{
          color: 'var(--eb-navbar-fg)', fontSize: '0.9rem', maxWidth: 240,
          background: 'none', border: 'none', padding: '0.25rem 0.5rem', borderRadius: '0.375rem',
          justifySelf: 'center',
        }}
        onClick={toggle}
        title="System information"
        aria-expanded={open}
      >
        <span className="text-truncate">{hostname}</span>
      </button>
      {panel}
    </>
  )
}
