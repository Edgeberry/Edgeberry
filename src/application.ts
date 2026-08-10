/*
 *  Application
 *  Interaction with application related features
 */

/*
 *  Views the application offers in the web interface.
 *
 *  An application declares these through SetApplicationInfo, and the interface
 *  builds its application menu from them. Freya, for instance, offers a
 *  'Dashboard' and an 'Editor'.
 *
 *  Everything here arrives from another process over D-Bus, so it is validated
 *  rather than trusted: these values end up in an iframe `src` and a link
 *  `href` in the web interface.
 */
export type ApplicationRouteTarget = 'iframe' | 'tab';

/** A view, as the device keeps and serves it — every field settled. */
export type ApplicationRoute = {
    label:   string,
    path:    string,
    target:  ApplicationRouteTarget,
    default: boolean,
    /** Stable name the interface addresses this view by, derived from the label. */
    slug:    string,
    /**
     * Font Awesome classes for the menu icon, canonical and complete
     * ('fa-solid fa-gauge'). Absent when the application declared none, and the
     * interface falls back to an icon for the target.
     */
    icon?:   string,
}

/** A view as an application declares it; the device fills in the rest. */
export type ApplicationRouteInput = {
    label:    string,
    path:     string,
    target?:  ApplicationRouteTarget,
    default?: boolean,
    icon?:    string,
}

// Mirrors the published SDK contract (sdk/node/src/edgeberry.ts). These fields
// were declared as the literal type '' rather than string, which made every
// value except the empty string unassignable — the `as ApplicationInfo` cast in
// dbusInterface.ts was the only reason it type-checked.
//
// What an application sends. `routes` is deliberately unknown: it is validated
// by normalizeRoutes() rather than believed.
export type ApplicationInfoInput = {
    name: string,
    description?: string,
    version?: string,
    routes?: unknown
}

/** What the device keeps and serves, with the routes settled. */
export type ApplicationInfo = {
    name: string,
    description?: string,
    version?: string,
    routes: ApplicationRoute[]
}

// The status an application reports over D-Bus. 'level' is the severity, and
// the SDKs also document 'error' between 'warning' and 'critical'.
export type ApplicationStatus = {
    level: string,
    message?: string
}

// Bounds on what an application may declare. Neither is a security control —
// the validation below is — they keep one application from rendering a menu
// nobody can use.
const MAX_ROUTES       = 10;
const MAX_LABEL_LENGTH = 40;

// Application info
let app_applicationInfo:ApplicationInfo|null = null;

// Last status the application reported.
//
// The severity is also pushed into the StateManager because it drives the
// status LED and buzzer. The message is kept here instead: everything the
// StateManager stores goes through canonical(), which lowercases and trims —
// fine for state enums, wrong for text meant to be shown to a human.
let app_applicationStatus:ApplicationStatus|null = null;

// Get system application info
export function app_getApplicationInfo(){
    return app_applicationInfo;
}

// Set the application info
export function app_setApplicationInfo( applicationInfo:ApplicationInfoInput ){
    app_applicationInfo = {
        name:        applicationInfo.name,
        description: applicationInfo.description,
        version:     applicationInfo.version,
        routes:      normalizeRoutes(applicationInfo.routes),
    };
    console.log(app_applicationInfo);
}

// Get the last reported application status
export function app_getApplicationStatus(){
    return app_applicationStatus;
}

// Set the application status
export function app_setApplicationStatus( applicationStatus:ApplicationStatus ){
    app_applicationStatus = applicationStatus;
}

/*
 *  Route validation
 */

/**
 * Accept a location the web interface can safely open, or an explanation.
 *
 * Two forms are allowed: a path inside the application, and an absolute http(s)
 * URL for something served elsewhere. Every other scheme is refused —
 * `javascript:` above all, since these values become an iframe `src` and a link
 * `href`.
 *
 * A path here is the application's *own* path. It is reached from outside under
 * the pass-through prefix, so nothing an application declares can collide with
 * the device's own routing and there is no reserved list to enforce: '/api'
 * means the application's /api, not the device's.
 */
function normalizePath( value:unknown ):{ path:string } | { error:string }{
    if(typeof value !== 'string' || !value.trim()) return { error:'no path' };
    const path = value.trim();

    if(path.startsWith('/')){
        // '//host/…' is protocol-relative, not a path: the browser reads it as
        // another origin and leaves the device entirely.
        if(path.startsWith('//'))
            return { error:`'${path}' is not a path` };
        // '..' would climb back out of the prefix the application is mounted under.
        if(path.split('/').includes('..'))
            return { error:`'${path}' must not contain '..'` };
        if(/\s|[{};]/.test(path))
            return { error:`'${path}' contains characters that are not valid in a URL path` };

        // A trailing slash makes a different location than the same path
        // without one; settle on one form so two spellings cannot both be
        // declared and show up as two menu items for one page. The application
        // root stays '/'.
        return { path: path.replace(/\/+$/, '') || '/' };
    }

    try{
        const url = new URL(path);
        if(url.protocol !== 'http:' && url.protocol !== 'https:')
            return { error:`'${path}' is not an http(s) URL` };
        return { path: url.toString() };
    } catch(_err){
        return { error:`'${path}' is neither a path on this device nor an http(s) URL` };
    }
}

/*
 *  Icons
 *
 *  The free Font Awesome set the interface bundles ships three styles. An
 *  application names one of them, or nothing and gets 'solid'.
 */
const ICON_STYLES = ['solid', 'regular', 'brands'];

/** Font Awesome names are lowercase words joined by single hyphens. */
const ICON_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const MAX_ICON_LENGTH = 40;

/**
 * Accept an icon an application declared, as the class pair that renders it.
 *
 * This value is written straight into a `class` attribute in the interface, so
 * it is rebuilt from a validated style and a validated name rather than passed
 * through — nothing an application writes reaches the DOM verbatim.
 *
 * Both spellings are accepted, because both are things people will write: the
 * bare name from Font Awesome's search ('gauge'), and the class list copied off
 * the icon's page ('fa-brands fa-github'). The 'fa-' prefixes are optional on
 * either token.
 */
function normalizeIcon( value:unknown ):{ icon:string } | { error:string }{
    if(typeof value !== 'string' || !value.trim()) return { error:'not a string' };
    if(value.length > MAX_ICON_LENGTH) return { error:`longer than ${MAX_ICON_LENGTH} characters` };

    const tokens = value.trim().toLowerCase().split(/\s+/).map(token => token.replace(/^fa-/, ''));
    if(tokens.length > 2) return { error:`'${value}' is not an icon name` };

    // One token is the name alone; two are a style and a name, in that order.
    const [style, name] = tokens.length === 2 ? tokens : ['solid', tokens[0]];

    if(!ICON_STYLES.includes(style))
        return { error:`'${style}' is not a Font Awesome style (expected one of ${ICON_STYLES.join(', ')})` };
    // 'fa-solid' on its own names a style and no icon.
    if(tokens.length === 1 && ICON_STYLES.includes(name))
        return { error:`'${value}' names a style but no icon` };
    if(!ICON_NAME_PATTERN.test(name))
        return { error:`'${name}' is not a Font Awesome icon name` };

    return { icon:`fa-${style} fa-${name}` };
}

/** Reduce a label to something addressable in a URL. */
export function slugify( label:string ):string{
    return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Turn what an application declared into a settled list of views.
 *
 * Invalid entries are dropped rather than rejecting the whole declaration: an
 * application that gets one route wrong should still get the others. Each drop
 * is logged, because SetApplicationInfo answers 'ok' either way — the log is
 * the only place the author of a malformed route can find out why their menu
 * item never appeared.
 */
function normalizeRoutes( value:unknown ):ApplicationRoute[]{
    if(value === undefined || value === null) return [];
    if(!Array.isArray(value)){
        console.log('\x1b[33mApplication routes ignored: expected an array, got '+typeof value+'\x1b[37m');
        return [];
    }

    const routes:ApplicationRoute[] = [];
    const taken  = new Set<string>();
    const claimed = new Set<string>();

    const reject = ( index:number, reason:string ) =>
        console.log('\x1b[33mApplication route '+index+' ignored: '+reason+'\x1b[37m');

    for(const [index, entry] of (value as ApplicationRouteInput[]).entries()){
        if(routes.length >= MAX_ROUTES){
            reject(index, `more than ${MAX_ROUTES} routes declared`);
            continue;
        }
        if(!entry || typeof entry !== 'object'){
            reject(index, 'not an object');
            continue;
        }

        const label = typeof entry.label === 'string' ? entry.label.trim().slice(0, MAX_LABEL_LENGTH) : '';
        if(!label){
            reject(index, 'no label');
            continue;
        }

        // The reason is quoted back: 'editor' failing where '/editor' would have
        // worked is otherwise invisible to whoever wrote it.
        const resolved = normalizePath(entry.path);
        if('error' in resolved){
            reject(index, resolved.error);
            continue;
        }
        const path = resolved.path;

        // Two routes on one path would generate two nginx locations for it,
        // which nginx refuses to load — taking every route down, not just this one.
        if(claimed.has(path)){
            reject(index, `'${path}' is claimed twice`);
            continue;
        }
        claimed.add(path);

        // Labels are the application's to choose and need not be unique; the
        // slug the interface addresses a view by does.
        const base = slugify(label) || 'view';
        let slug = base;
        for(let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
        taken.add(slug);

        /*
         *  A bad icon costs the route its icon, not its place in the menu:
         *  it is decoration on a view that otherwise works, and dropping the
         *  whole entry would take a working page away over a typo. The reason
         *  is logged like any other rejection.
         */
        let icon:string|undefined;
        if(entry.icon !== undefined && entry.icon !== null){
            const resolvedIcon = normalizeIcon(entry.icon);
            if('error' in resolvedIcon) reject(index, `icon ignored: ${resolvedIcon.error}`);
            else icon = resolvedIcon.icon;
        }

        routes.push({
            label,
            path,
            /*
             *  Framing is the default for a page on this device: it keeps the
             *  device's navigation and status in front of whoever is using it.
             *
             *  Somewhere else on the internet defaults to a tab instead. Most
             *  sites refuse to be framed, and an iframe that silently renders
             *  nothing is a worse answer than a link. An explicit 'iframe' still
             *  wins, for the ones that allow it.
             */
            target:  entry.target === 'iframe' ? 'iframe'
                   : entry.target === 'tab'    ? 'tab'
                   : path.startsWith('/')      ? 'iframe'
                   :                             'tab',
            default: entry.default === true,
            slug,
            icon,
        });
    }

    if(!routes.length) return routes;

    // Exactly one default, always: the interface needs to know what to open when
    // no view is named. The application's choice wins. Failing that, prefer a
    // framed view — the application page has nothing to show for a route that
    // only ever opens in a tab.
    const chosen = routes.find(route => route.default)
                ?? routes.find(route => route.target === 'iframe')
                ?? routes[0];
    for(const route of routes) route.default = (route === chosen);

    return routes;
}

// Starting, stopping and restarting the application are not implemented. The
// direct methods that would call them answer 501; see directMethods.ts.
