import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BrowserRouter, NavLink, Routes, Route } from 'react-router-dom'
import { Modal } from 'bootstrap'
import { api, type AppHealth, type ApplicationRoute, type ConnectionState, type ProvisionState, type WifiState } from './api'
import Network from './pages/Network'
import Cloud from './pages/Cloud'
import TerminalPage from './pages/Terminal'
import ApplicationPage from './pages/Application'
import SystemInfoMenu from './components/SystemInfo'
import edgeberryLogo from './assets/logo.svg'

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

function ApplicationIcon({ health, name, version, message }: {
  health: AppHealth; name: string | null; version: string | null; message: string | null
}) {
  // The application names and versions itself through the SDK. Until it has
  // reported, there is nothing to name it after.
  const app = name ? (version ? `${name} ${version}` : name) : 'Application'

  // The message is the application's own account of why it is in this state,
  // which is the reason surfacing status here is worth anything at all. Prefer
  // it over our generic wording whenever the application supplied one.
  const title = (fallback: string) => (message ? `${app} — ${message}` : `${app} — ${fallback}`)

  if (health === 'ok')
    return <i className="fa-solid fa-cube" style={{ color: 'var(--eb-ok)' }} title={title('running normally')} />
  if (health === 'warning')
    return <i className="fa-solid fa-cube" style={{ color: 'var(--eb-warn)' }} title={title('warning')} />
  // error, critical and emergency all mean "attention now" and share the fault
  // colour; the tooltip carries the severity that the hue cannot.
  if (health === 'error')
    return <i className="fa-solid fa-cube" style={{ color: 'var(--eb-fault)' }} title={title('error')} />
  if (health === 'critical')
    return <i className="fa-solid fa-cube" style={{ color: 'var(--eb-fault)' }} title={title('critical')} />
  if (health === 'emergency')
    return <i className="fa-solid fa-cube" style={{ color: 'var(--eb-fault)' }} title={title('emergency')} />

  // Nothing reported yet. Deliberately distinct from an application that has
  // reported it is fine — a silent application is not a healthy one.
  return <i className="fa-solid fa-cube" style={{ color: 'var(--eb-idle)' }}
    title={name ? `${app} — status unknown` : 'No application reporting'} />
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

/**
 * A dropdown anchored under its trigger and rendered into document.body.
 *
 * The portal is what makes it usable: the navbar establishes a stacking context
 * that would otherwise clip the menu. Shared by the device menu and the
 * application menu so the two cannot drift apart in placement or dismissal.
 */
function PortalMenu({ trigger, title, buttonStyle, children }: {
  trigger:      React.ReactNode
  title:        string
  buttonStyle?: React.CSSProperties
  children:     (close: () => void) => React.ReactNode
}) {
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

    /* pointerdown rather than mousedown so a tap dismisses the menu too. The
       menu itself stops this event, so only presses outside arrive here. */
    function closeOnPress(e: PointerEvent) {
      if (btnRef.current && !btnRef.current.contains(e.target as Node)) setOpen(false)
    }

    /* The application occupies the page as an iframe, and a press inside that
       document never reaches this one — which left the menu stuck open over
       most of the screen. Losing window focus is the only signal we get that
       the press landed in there. It also covers leaving the browser entirely,
       where dismissing the menu is what you would expect anyway. */
    function closeOnFocusLoss() { setOpen(false) }

    document.addEventListener('pointerdown', closeOnPress)
    window.addEventListener('blur', closeOnFocusLoss)
    return () => {
      document.removeEventListener('pointerdown', closeOnPress)
      window.removeEventListener('blur', closeOnFocusLoss)
    }
  }, [open])

  const menu = open ? createPortal(
    <ul
      className="eb-menu"
      style={{
        position: 'fixed', top: pos.top, right: pos.right, zIndex: 99999,
        listStyle: 'none', margin: 0, padding: '0.25rem 0',
        backgroundColor: 'var(--eb-navbar-bg)', border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: '0.375rem', minWidth: 160,
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
      }}
      onPointerDown={e => e.stopPropagation()}
    >
      {children(() => setOpen(false))}
    </ul>,
    document.body
  ) : null

  return (
    <>
      <button
        ref={btnRef}
        className="btn btn-sm d-flex align-items-center"
        style={{ color: 'var(--eb-navbar-fg)', lineHeight: 1, background: 'none', border: 'none',
                 padding: '0.25rem 0.5rem', ...buttonStyle }}
        onClick={toggle}
        title={title}
      >
        {trigger}
      </button>
      {menu}
    </>
  )
}

/** Where the application view lives for a given declared route. */
function viewPath( route:ApplicationRoute ):string {
  return `/?view=${encodeURIComponent(route.slug)}`
}

/**
 * The menu icon for a route.
 *
 * An application may name a Font Awesome icon per route; the device validates
 * it and hands over a canonical class pair, so it is safe to interpolate here.
 * Without one, the icon describes what the item does — leaves the device, or
 * opens a view inside it.
 */
function routeIcon( route:ApplicationRoute ):string {
  if (route.icon) return route.icon
  return route.target === 'tab' ? 'fa-solid fa-arrow-up-right-from-square' : 'fa-solid fa-window-maximize'
}

/**
 * The application's own menu.
 *
 * An application declares the views it offers through SetApplicationInfo — for
 * Node-RED that is typically a dashboard and an editor — and this is where they
 * surface. With one view there is nothing to choose between, so the icon
 * addresses it directly rather than making someone open a menu to reach the
 * only item in it.
 */
function ApplicationMenu({ routes, icon }: { routes: ApplicationRoute[]; icon: React.ReactNode }) {
  const triggerStyle = { lineHeight: 1, background: 'none', border: 'none', padding: '0.25rem 0.4rem' }

  // Nothing declared: '/' frames /dashboard, the behaviour that predates routes.
  if (routes.length === 0)
    return (
      <NavLink className="btn btn-sm d-flex align-items-center" style={triggerStyle} to="/">{icon}</NavLink>
    )

  if (routes.length === 1) {
    const [only] = routes
    if (only.target !== 'tab')
      return (
        <NavLink className="btn btn-sm d-flex align-items-center" style={triggerStyle} to={viewPath(only)}>{icon}</NavLink>
      )
    return (
      <a className="btn btn-sm d-flex align-items-center" style={triggerStyle} title={only.label}
        href={only.url} target="_blank" rel="noopener noreferrer">{icon}</a>
    )
  }

  return (
    <PortalMenu title="Application" trigger={icon} buttonStyle={{ padding: '0.25rem 0.4rem' }}>
      {close => routes.map(route => (
        <li key={route.slug}>
          {route.target === 'tab' ? (
            /* noreferrer alongside noopener: the location is the application's
               to choose and may well be off this device. */
            <a className="dropdown-item d-flex align-items-center gap-2"
              href={route.url} target="_blank" rel="noopener noreferrer" onClick={close}>
              <i className={`${routeIcon(route)} fa-fw`} />{route.label}
            </a>
          ) : (
            <NavLink className="dropdown-item d-flex align-items-center gap-2"
              to={viewPath(route)} onClick={close}>
              <i className={`${routeIcon(route)} fa-fw`} />{route.label}
            </NavLink>
          )}
        </li>
      ))}
    </PortalMenu>
  )
}

function NavMenu({ onOpenTerminal, onOpenPower }: { onOpenTerminal: () => void; onOpenPower: () => void }) {
  return (
    <PortalMenu title="Menu" trigger={<i className="fa-solid fa-ellipsis-vertical" />}>
      {close => (
        <>
          <li>
            <button className="dropdown-item d-flex align-items-center gap-2"
              onClick={() => { close(); onOpenTerminal() }}>
              <i className="fa-solid fa-terminal fa-fw" />Terminal
            </button>
          </li>
          <li>
            <button className="dropdown-item d-flex align-items-center gap-2"
              onClick={() => { close(); api.system.identify().catch(() => {}) }}>
              <i className="fa-solid fa-location-dot fa-fw" />Identify
            </button>
          </li>
          <li>
            <button className="dropdown-item d-flex align-items-center gap-2"
              onClick={() => { close(); onOpenPower() }}>
              <i className="fa-solid fa-power-off fa-fw" />Power
            </button>
          </li>
        </>
      )}
    </PortalMenu>
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
  appHealth:       AppHealth
  appName:         string | null
  appVersion:      string | null
  appMessage:      string | null
  appRoutes:       ApplicationRoute[]
  appLogo:         string | null
}

function NavBar(props: NavBarProps) {
  const iconButtonStyle = { lineHeight: 1, background: 'none', border: 'none', padding: '0.25rem 0.4rem' }

  return (
    <nav className="navbar navbar-dark" style={{ backgroundColor: 'var(--eb-navbar-bg)' }}>
      {/* Each item is pinned to its column rather than left to auto-placement.
          The device name hides itself below Bootstrap's sm breakpoint, and a
          display:none item leaves the grid altogether — which used to drop the
          icons into the middle column, where justifySelf:'end' aligned them to
          the end of a centred column instead of the right edge of the bar. */}
      <div className="container-fluid" style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center' }}>
        {/* The application's logo displaces Edgeberry's when it supplies one:
            the device is the platform, but the product is the application. */}
        <NavLink className="navbar-brand mb-0" to="/" style={{ gridColumn: 1, justifySelf: 'start' }}>
          <img src={props.appLogo ?? edgeberryLogo}
               alt={props.appLogo ? (props.appName ?? 'Application') : 'Edgeberry'}
               height="28" style={{ maxHeight: 28, width: 'auto' }} />
        </NavLink>

        {/* The wrapper stays in the grid even when its contents do not, holding
            the middle column open at zero width so the outer 1fr columns keep
            splitting the bar evenly. */}
        <div style={{ gridColumn: 2, justifySelf: 'center', minWidth: 0 }}>
          <SystemInfoMenu hostname={props.hostname} logo={props.appLogo} />
        </div>

        <div className="d-flex align-items-center gap-1" style={{ gridColumn: 3, justifySelf: 'end' }}>
          {/* The application is what the device is for, so it leads the row.
              It addresses the application's own views rather than opening a
              modal like the two device-level icons beside it. */}
          <ApplicationMenu
            routes={props.appRoutes}
            icon={<ApplicationIcon health={props.appHealth} name={props.appName}
              version={props.appVersion} message={props.appMessage} />}
          />
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
  const titleId     = useId()

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

  /* aria-labelledby points at the header title: it is the only place the modal
     is named now that the pages inside no longer repeat it. */
  return (
    <div ref={elementRef} className="modal fade" tabIndex={-1} aria-hidden="true" aria-labelledby={titleId}>
      {/* Large but windowed, so the device page stays visible behind it. Phones
          keep the full-screen treatment, where a margin would only waste space. */}
      <div className="modal-dialog modal-xl modal-dialog-centered modal-fullscreen-sm-down">
        <div className="modal-content eb-modal-content" style={{ background: background ?? 'var(--eb-bg)', border: 'none' }}>
          <div className="modal-header" style={{ background: 'var(--eb-navbar-bg)', border: 'none', padding: '0.5rem 1rem' }}>
            <span className="modal-title fw-semibold" id={titleId} style={{ color: 'var(--eb-navbar-fg)', fontSize: '0.9rem' }}>
              <i className={`fa-solid ${icon} me-2`} style={{ color: 'var(--eb-primary)' }} />{title}
            </span>
            <button type="button" className="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Close" />
          </div>
          {/* minHeight:0 lets the body scroll (and the terminal flex) inside the
              fixed-height content instead of pushing past it. */}
          <div className={bodyClassName ?? 'modal-body'} style={{ overflow: 'auto', flex: '1 1 auto', minHeight: 0 }}>
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
              <i className="fa-solid fa-power-off me-2" style={{ color: 'var(--eb-primary)' }} />Power
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
  const [appHealth,       setAppHealth]       = useState<AppHealth>('unknown')
  const [appName,         setAppName]         = useState<string | null>(null)
  const [appVersion,      setAppVersion]      = useState<string | null>(null)
  const [appMessage,      setAppMessage]      = useState<string | null>(null)
  const [appRoutes,       setAppRoutes]       = useState<ApplicationRoute[]>([])
  const [appLogo,         setAppLogo]         = useState<string | null>(null)
  const [appMark,         setAppMark]         = useState<string | null>(null)
  const [appColors,       setAppColors]       = useState<Record<string, string> | null>(null)
  const [apNoticeDismissed, setApNoticeDismissed] = useState(false)

  useEffect(() => { if (hostname) document.title = hostname }, [hostname])

  /*
   *  Paint the application's colours over the bundled defaults.
   *
   *  Set on the document element, where they outrank the :root rule the theme
   *  stylesheet defines, so only the tokens an application actually names are
   *  displaced. Removing one puts the default back without a reload.
   */
  useEffect(() => {
    const root = document.documentElement
    const colors = appColors ?? {}

    /*
     *  The top bar is its own surface, dark by default and independent of the
     *  page so that Edgeberry's own light theme still gets dark chrome. Once an
     *  application states a background, though, that independence reads as a
     *  mismatch — a bar at #1e1e1e against a page at #292B2D looks like a
     *  mistake rather than a choice. So a declared background carries the bar
     *  with it, and only the default is independent.
     *
     *  Derived here rather than in the stylesheet because these are read back
     *  with getComputedStyle (the terminal takes its colours that way), and a
     *  custom property holding color-mix() would come back as the unresolved
     *  expression rather than a colour.
     */
    const derived: Record<string, string> = { ...colors }
    if (colors.bg) derived['navbar-bg'] = colors.bg
    if (colors.fg) derived['navbar-fg'] = colors.fg

    const applied = Object.entries(derived)
    for (const [token, value] of applied) root.style.setProperty(`--eb-${token}`, value)
    return () => { for (const [token] of applied) root.style.removeProperty(`--eb-${token}`) }
  }, [appColors])

  /*
   *  Let the application's mark stand in as the browser tab icon.
   *
   *  The shipped link carries type="image/svg+xml"; an application's mark is
   *  just as likely to be a .ico or .png, and a browser given the wrong type
   *  declines to render it. Dropping the attribute lets it sniff instead.
   */
  useEffect(() => {
    if (!appMark) return
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (!link) return
    const previousHref = link.getAttribute('href')
    const previousType = link.getAttribute('type')
    link.setAttribute('href', appMark)
    link.removeAttribute('type')
    return () => {
      if (previousHref !== null) link.setAttribute('href', previousHref)
      if (previousType !== null) link.setAttribute('type', previousType)
    }
  }, [appMark])

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
          setAppHealth(state.application?.health ?? 'unknown')
          setAppName(state.application?.name ?? null)
          setAppVersion(state.application?.version ?? null)
          setAppMessage(state.application?.message ?? null)
          setAppRoutes(state.application?.routes ?? [])
          setAppLogo(state.application?.branding?.logo ?? null)
          setAppMark(state.application?.branding?.mark ?? null)
          setAppColors(state.application?.branding?.colors ?? null)
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
        appHealth={appHealth}
        appName={appName}
        appVersion={appVersion}
        appMessage={appMessage}
        appRoutes={appRoutes}
        appLogo={appLogo}
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
            {/* These pages carry no heading of their own — inside a modal the
                header already names them. Reached directly by URL there is no
                header, so the route supplies the heading. */}
            <Route path="/network" element={<div className="p-4"><h1 className="h4 mb-4">Network</h1><Network /></div>} />
            <Route path="/cloud" element={<div className="p-4"><h1 className="h4 mb-4">Cloud Connection</h1><Cloud /></div>} />
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
