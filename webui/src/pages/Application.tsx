import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'

/* How often to re-probe while no application is reachable, so the view
   recovers on its own once one appears rather than needing a reload. */
const RETRY_INTERVAL_MS = 10000

type Probe = 'checking' | 'present' | 'absent'

/*
 *  The application view.
 *
 *  The device serves whatever application has claimed /dashboard. nginx sends
 *  every unclaimed path to the Device Service, which answers with this very
 *  interface — so when no application is routed there, framing /dashboard
 *  blindly renders the interface inside itself, recursively. That reads as a
 *  rendering bug rather than what it is: nothing is running.
 *
 *  So the target is probed first. The Device Service tags its fallback with
 *  X-Edgeberry-Fallback; anything carrying that header is not an application.
 */
export default function ApplicationPage() {
  const dashboardUrl = `${location.protocol}//${location.host}/dashboard`

  const [probe, setProbe] = useState<Probe>('checking')
  const [appName, setAppName] = useState<string | null>(null)

  const check = useCallback(() => {
    fetch(dashboardUrl, { redirect: 'follow', cache: 'no-store' })
      .then(res => {
        // The fallback answers 200, so the status alone proves nothing — the
        // header is what distinguishes "no application" from a real one.
        const isFallback = res.headers.get('X-Edgeberry-Fallback') !== null
        setProbe(res.ok && !isFallback ? 'present' : 'absent')
      })
      .catch(() => setProbe('absent'))
  }, [dashboardUrl])

  useEffect(() => {
    check()
    // Name the application in the message when the device knows what it is.
    api.getState()
      .then(state => setAppName(state.application?.name ?? null))
      .catch(() => {})
  }, [check])

  useEffect(() => {
    if (probe !== 'absent') return
    const timer = setInterval(check, RETRY_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [probe, check])

  // Nothing is drawn while probing: the check is a single local request, and
  // flashing a placeholder before the application appears is worse than a beat
  // of empty space.
  if (probe === 'checking') return <div style={{ flex: 1 }} />

  if (probe === 'absent') {
    return (
      <div
        className="d-flex flex-column align-items-center justify-content-center text-center p-4"
        style={{ flex: 1, gap: '0.75rem' }}
      >
        <i className="fa-solid fa-cube" style={{ fontSize: '2.5rem', color: 'var(--eb-idle)' }} />
        <div className="fw-semibold" style={{ fontSize: '1.1rem' }}>No application running</div>
        <div style={{ maxWidth: '32rem', opacity: 0.75, fontSize: '0.9rem' }}>
          {appName
            ? <>This device reports an application named <strong>{appName}</strong>, but nothing is
               answering at <code>/dashboard</code>.</>
            : <>Nothing is answering at <code>/dashboard</code> on this device.</>}
          {' '}An application registers that path by adding a route to{' '}
          <code>/opt/Edgeberry/Core/config/nginx/routes.d/</code>.
        </div>
        <button className="btn btn-sm btn-outline-secondary" onClick={() => { setProbe('checking'); check() }}>
          Retry
        </button>
        <div style={{ fontSize: '0.75rem', opacity: 0.5 }}>Retrying automatically every 10 seconds.</div>
      </div>
    )
  }

  return (
    <iframe
      src={dashboardUrl}
      style={{ flex: 1, width: '100%', height: '100%', border: 'none', display: 'block' }}
      title={appName ?? 'Application'}
    />
  )
}
