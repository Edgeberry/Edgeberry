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
}

/** A view as an application declares it; the device fills in the rest. */
export type ApplicationRouteInput = {
    label:    string,
    path:     string,
    target?:  ApplicationRouteTarget,
    default?: boolean,
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
 * Accept a location the web interface can safely open, or null.
 *
 * Two forms are allowed: a path on this device, and an absolute http(s) URL for
 * an application listening on its own port. Every other scheme is refused —
 * `javascript:` above all, since these values become an iframe `src` and a link
 * `href`.
 */
function normalizePath( value:unknown ):string|null{
    if(typeof value !== 'string') return null;
    const path = value.trim();
    if(!path) return null;

    if(path.startsWith('/')){
        // '//host/…' is protocol-relative, not a path: the browser reads it as
        // another origin and leaves the device entirely.
        return path.startsWith('//') ? null : path;
    }

    try{
        const url = new URL(path);
        return (url.protocol === 'http:' || url.protocol === 'https:') ? url.toString() : null;
    } catch(_err){
        return null;
    }
}

/** Reduce a label to something addressable in a URL. */
function slugify( label:string ):string{
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
        const path  = normalizePath(entry.path);
        if(!label){
            reject(index, 'no label');
            continue;
        }
        if(!path){
            // The rejected value is quoted back: 'editor' failing where
            // '/editor' would have worked is otherwise invisible.
            reject(index, `'${String(entry.path)}' is not a path on this device or an http(s) URL`);
            continue;
        }

        // Labels are the application's to choose and need not be unique; the
        // slug the interface addresses a view by does.
        const base = slugify(label) || 'view';
        let slug = base;
        for(let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
        taken.add(slug);

        routes.push({
            label,
            path,
            // Framing is the default because a view that stays inside the
            // interface keeps the device's navigation and status in front of
            // whoever is using it.
            target:  entry.target === 'tab' ? 'tab' : 'iframe',
            default: entry.default === true,
            slug,
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
