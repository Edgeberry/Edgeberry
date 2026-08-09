import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, type ApplicationRoute } from '../api'

/* How often to re-probe while no application is reachable, so the view
   recovers on its own once one appears rather than needing a reload. */
const RETRY_INTERVAL_MS = 10000

/* Where an application ends up when it has declared no views of its own. */
const DEFAULT_PATH = '/dashboard'

type Probe = 'checking' | 'present' | 'absent'

/*
 *  The application view.
 *
 *  An application declares the views it offers through SetApplicationInfo, and
 *  `?view=<slug>` names which of them to frame. Without a declaration the device
 *  falls back to /dashboard, which is where applications lived before they could
 *  say anything about themselves.
 *
 *  The target is probed before being framed. nginx sends every unclaimed path to
 *  the Device Service, which answers with this very interface — so framing a
 *  path blindly renders the interface inside itself, recursively. That reads as
 *  a rendering bug rather than what it is: nothing is running there. The Device
 *  Service tags its fallback with X-Edgeberry-Fallback; anything carrying that
 *  header is not an application.
 */
export default function ApplicationPage() {
  const [params] = useSearchParams()
  const requested = params.get('view')

  const [routes, setRoutes] = useState<ApplicationRoute[] | null>(null)
  const [appName, setAppName] = useState<string | null>(null)
  /* The result is kept with the target it was measured against, so switching
     views reads as 'checking' on its own rather than needing an effect to
     reset it as the target changes. */
  const [probed, setProbed] = useState<{ target: string; state: Probe } | null>(null)

  useEffect(() => {
    api.getState()
      .then(state => {
        setAppName(state.application?.name ?? null)
        setRoutes(state.application?.routes ?? [])
      })
      // An unreachable device is not a missing application: fall back to the
      // undeclared behaviour rather than leaving the view stuck on 'checking'.
      .catch(() => setRoutes([]))
  }, [])

  /*
   *  Which view to frame.
   *
   *  A route that only ever opens in a tab has nothing to show here, so it is
   *  not framable and the default stands in for it — reaching one of those from
   *  the menu opens a tab and leaves this view where it was.
   */
  const framable = routes?.filter(route => route.target === 'iframe') ?? []
  const selected = framable.find(route => route.slug === requested)
                ?? framable.find(route => route.default)
                ?? framable[0]
                ?? null

  /* Nothing to frame in two cases: the state has not arrived yet, and every
     declared view opens in a tab. Neither is a missing application, so neither
     falls back to probing /dashboard. */
  const target = routes === null ? null
    : selected                   ? selected.path
    : routes.length              ? null
    : DEFAULT_PATH

  /* Only same-origin paths can be probed. An application declaring an absolute
     URL is on another origin, where the fetch is opaque or blocked outright —
     reporting that as 'absent' would be reading CORS as a missing application.
     Those are taken on trust, and the frame shows whatever it finds. */
  const probeable = target !== null && target.startsWith('/')

  const probe: Probe = target === null ? 'checking'
    : !probeable                       ? 'present'
    : probed?.target === target        ? probed.state
    : 'checking'

  const check = useCallback(() => {
    if (!target || !target.startsWith('/')) return

    fetch(target, { redirect: 'follow', cache: 'no-store' })
      .then(res => {
        // The fallback answers 200, so the status alone proves nothing — the
        // header is what distinguishes "no application" from a real one.
        const isFallback = res.headers.get('X-Edgeberry-Fallback') !== null
        setProbed({ target, state: res.ok && !isFallback ? 'present' : 'absent' })
      })
      .catch(() => setProbed({ target, state: 'absent' }))
  }, [target])

  useEffect(() => { check() }, [check])

  useEffect(() => {
    if (probe !== 'absent') return
    const timer = setInterval(check, RETRY_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [probe, check])

  // Every declared view opens in a tab, so this page has nothing to show. Say
  // so and point at the menu that does — reporting a missing application here
  // would be blaming the device for a choice the application made.
  if (target === null && routes !== null && routes.length > 0) {
    return (
      <div
        className="d-flex flex-column align-items-center justify-content-center text-center p-4"
        style={{ flex: 1, gap: '0.75rem' }}
      >
        <i className="fa-solid fa-arrow-up-right-from-square" style={{ fontSize: '2.5rem', color: 'var(--eb-idle)' }} />
        <div className="fw-semibold" style={{ fontSize: '1.1rem' }}>Opens in a new tab</div>
        <div style={{ maxWidth: '32rem', opacity: 0.75, fontSize: '0.9rem' }}>
          {appName ? <><strong>{appName}</strong> offers</> : <>This application offers</>}
          {routes.length === 1 ? <> one view, which opens</> : <> {routes.length} views, which open</>}
          {' '}outside this interface. Use the application menu in the navigation bar.
        </div>
      </div>
    )
  }

  // Nothing is drawn while probing: the check is a single local request, and
  // flashing a placeholder before the application appears is worse than a beat
  // of empty space.
  if (probe === 'checking' || !target) return <div style={{ flex: 1 }} />

  if (probe === 'absent') {
    return (
      <div
        className="d-flex flex-column align-items-center justify-content-center text-center p-4"
        style={{ flex: 1, gap: '0.75rem' }}
      >
        <i className="fa-solid fa-cube" style={{ fontSize: '2.5rem', color: 'var(--eb-idle)' }} />
        <div className="fw-semibold" style={{ fontSize: '1.1rem' }}>
          {selected ? `${selected.label} is not answering` : 'No application running'}
        </div>
        <div style={{ maxWidth: '32rem', opacity: 0.75, fontSize: '0.9rem' }}>
          {appName
            ? <>This device reports an application named <strong>{appName}</strong>, but nothing is
               answering at <code>{target}</code>.</>
            : <>Nothing is answering at <code>{target}</code> on this device.</>}
          {' '}An application registers that path by adding a route to{' '}
          <code>/opt/Edgeberry/Core/config/nginx/routes.d/</code>.
        </div>
        <button className="btn btn-sm btn-outline-secondary" onClick={() => { setProbed(null); check() }}>
          Retry
        </button>
        <div style={{ fontSize: '0.75rem', opacity: 0.5 }}>Retrying automatically every 10 seconds.</div>
      </div>
    )
  }

  return (
    <iframe
      src={target}
      style={{ flex: 1, width: '100%', height: '100%', border: 'none', display: 'block' }}
      title={selected?.label ?? appName ?? 'Application'}
    />
  )
}
