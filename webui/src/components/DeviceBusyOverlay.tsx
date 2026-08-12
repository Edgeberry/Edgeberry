/*
 *  Device Busy Overlay
 *
 *  Covers the interface while the device is away — rebooting, restarting its
 *  software, updating, or shutting down — and gets out of the way when it comes
 *  back.
 *
 *  This works because the page never navigates: the tab keeps running while the
 *  device disappears, so the overlay is a component that stays mounted rather
 *  than something that has to survive a reload. The device's own state, pushed
 *  over /api/state/stream, is what raises and clears it — see AppShell.
 *
 *  Purely presentational. Everything it needs to decide what to say is a prop,
 *  so what it does is legible without following the state machine that drives
 *  it. A hard refresh during downtime loses the overlay and lands on the
 *  browser's own error page; fixing that would take a service worker, which is
 *  far out of proportion.
 */

export type BusyKind = 'reboot' | 'shutdown' | 'restart' | 'update'

type Message = {
  icon:    string | null   // null shows a spinner instead: something is still in progress
  title:   string
  body:    string
  tone:    string          // status token for the icon
  dismiss: string | null   // null offers no way out: there is nothing to decide yet
}

function message( kind:BusyKind, starting:boolean, stalled:boolean ):Message {
  // A shutdown is not coming back, so its time limit is not a fault — it is how
  // long the host needs to actually halt, after which unplugging is safe.
  if (kind === 'shutdown')
    return stalled
      ? { icon: 'fa-plug-circle-xmark', tone: 'var(--eb-idle)', dismiss: 'Close',
          title: 'Safe to unplug',
          body:  'The device has shut down. It will not answer again until it is powered back on.' }
      : { icon: null, tone: 'var(--eb-primary)', dismiss: null,
          title: 'Shutting down…',
          body:  'Wait for the device to power off before unplugging it.' }

  // Past its time limit. Deliberately does not claim the device has failed: from
  // the browser's side a device that has not come back is indistinguishable from
  // one this browser can no longer reach.
  if (stalled)
    return { icon: 'fa-triangle-exclamation', tone: 'var(--eb-warn)', dismiss: 'Dismiss',
             title: 'Still waiting',
             body:  'The device has not come back yet. It may still be starting up, or this browser may have lost its connection to it.' }

  // Back on the network, but its software is still coming up — the device
  // reports 'starting' well before the interface is usable.
  if (starting)
    return { icon: null, tone: 'var(--eb-primary)', dismiss: null,
             title: 'Starting up…',
             body:  'The device is back. This will clear by itself.' }

  if (kind === 'update')
    return { icon: null, tone: 'var(--eb-primary)', dismiss: null,
             title: 'Updating…',
             body:  'Do not power the device off while this is running.' }

  if (kind === 'restart')
    return { icon: null, tone: 'var(--eb-primary)', dismiss: null,
             title: 'Restarting…',
             body:  'The device software is restarting.' }

  return { icon: null, tone: 'var(--eb-primary)', dismiss: null,
           title: 'Rebooting…',
           body:  'The device is restarting. This page comes back on its own.' }
}

export default function DeviceBusyOverlay({ kind, starting, stalled, onDismiss }: {
  kind:      BusyKind
  starting:  boolean
  stalled:   boolean
  onDismiss: () => void
}) {
  const { icon, title, body, tone, dismiss } = message(kind, starting, stalled)

  return (
    <div
      className="d-flex flex-column align-items-center justify-content-center text-center p-4"
      style={{
        // Opaque and over everything, bootstrap modals included (theirs is 1055).
        // Blocking is the honest presentation: nothing behind this works while
        // the device is away.
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'var(--eb-bg)', color: 'var(--eb-fg)', gap: '0.75rem',
      }}
    >
      {icon
        ? <i className={`fa-solid ${icon}`} style={{ fontSize: '2.5rem', color: tone }} />
        : <div className="spinner-border" style={{ width: '2.5rem', height: '2.5rem', color: tone }} role="status">
            <span className="visually-hidden">Working…</span>
          </div>}

      {/* Announced rather than shouted: the text changes underneath a reader as
          the device moves from rebooting to starting to back. */}
      <div role="status" aria-live="polite" className="d-flex flex-column align-items-center" style={{ gap: '0.75rem' }}>
        <div className="fw-semibold" style={{ fontSize: '1.1rem' }}>{title}</div>
        <div style={{ maxWidth: '32rem', opacity: 0.75, fontSize: '0.9rem' }}>{body}</div>
      </div>

      {dismiss && (
        <button className="btn btn-sm btn-outline-secondary mt-2" onClick={onDismiss}>{dismiss}</button>
      )}
    </div>
  )
}
