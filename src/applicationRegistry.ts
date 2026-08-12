/*
 *  Application registry
 *
 *  The one place that registers, forgets and re-reads the device's application.
 *
 *  The Core is the only writer. `edgeberry --register-application` calls in over
 *  D-Bus rather than editing settings.json itself, because settingsStore writes
 *  the whole in-memory object on every save — an outside edit would be erased by
 *  the next provisioning or connection change, and only later, which is the
 *  worst way to lose a registration.
 */

import path from 'path';

import {
    APPLICATION_PREFIX,
    ApplicationManifest,
    LifecycleAction,
    RegisteredApplication,
    readManifest,
    reloadNginx,
    runLifecycleAction,
    syncNginxRoutes,
} from './applicationManifest';
import { ApplicationRoute } from './application';
import { hostname_apply, hostname_claim, hostname_current } from './hostname';
import {
    settings_deleteApplication,
    settings_getApplication,
    settings_storeApplication,
} from './settingsStore';

/*
 *  The manifest is cached because it is read from another package's directory:
 *  every read is a chance for the file to have been replaced halfway through an
 *  application update. Re-read happens at the moments that mean something —
 *  registration and start — rather than on every caller's whim.
 */
let current:RegisteredApplication|null = null;

/*
 *  The routes the application last declared over D-Bus.
 *
 *  These are the menu, not the routing — everything under the pass-through
 *  prefix reaches the application whether or not it has declared anything.
 *  Kept in settings.json so the menu survives a Core restart: the application
 *  re-declares within a moment of the service coming back, and an interface
 *  that empties out and refills in between looks broken.
 */
let currentRoutes:ApplicationRoute[] = [];

/**
 * Make the device name follow the registered application.
 *
 * The prefix is read from `current` here rather than passed in by callers, so
 * there is no call site that can supply the wrong one. Unregistering sets
 * `current` to null first and gets the device's own 'EDGB' back out of the same
 * expression, rather than out of a second branch that could disagree with this
 * one.
 *
 * hostname_apply() never throws, so this is safe on the startup path.
 */
function applyDeviceName():void{
    hostname_apply(current?.manifest.hostnamePrefix ?? null);
}

/** The registered application as last read, or null when none is registered. */
export function registry_getApplication():RegisteredApplication|null{
    return current;
}

export function registry_getManifest():ApplicationManifest|null{
    return current?.manifest ?? null;
}

/**
 * Register an application directory.
 *
 * Everything is validated before anything is written: a manifest that names a
 * missing unit or an unusable port leaves the previous registration and the
 * previous routing exactly as they were.
 */
export function registry_register( applicationPath:string ):RegisteredApplication{
    if(!applicationPath || !applicationPath.startsWith('/'))
        throw new Error('an absolute path to the application directory is required');

    const resolved = path.resolve(applicationPath);
    const manifest = readManifest(resolved);
    const application:RegisteredApplication = { path: resolved, manifest };

    // nginx first: if the generated configuration will not load, nothing has
    // been registered and the device is still serving what it served before.
    const previous = current;
    current = application;
    try{
        // adopt: registration is the moment routing becomes ours to state, so a
        // conf the application installed by hand is replaced rather than left to
        // collide with the generated one.
        if(syncNginxRoutes(application, true)) reloadNginx();
    } catch(err){
        current = previous;
        syncNginxRoutes(previous, true);
        try{ reloadNginx(); } catch(_err){ /* restoring what already loaded */ }
        throw err;
    }

    settings_storeApplication(resolved, currentRoutes);
    applyDeviceName();
    console.log('\x1b[32mRegistered application \''+manifest.name+'\' from '+resolved+'\x1b[37m');
    return application;
}

/** Forget the registered application and take its routing with it. */
export function registry_unregister():void{
    const name = current?.manifest.name;
    current = null;
    currentRoutes = [];
    if(syncNginxRoutes(null)) reloadNginx();
    settings_deleteApplication();
    // Hands the device its own name back, if the name is still Edgeberry's to
    // give: an application that named the device does not get to keep it.
    applyDeviceName();
    console.log('\x1b[33mUnregistered application'+(name ? ' \''+name+'\'' : '')+'\x1b[37m');
}

/**
 * Take the device name back after somebody renamed the device by hand.
 *
 * The only way out of a released record, and deliberately something a person has
 * to ask for: 'edgeberry --hostname auto' is someone saying the device should be
 * Edgeberry's to name again. Returns the name that was settled on, which is the
 * previous one if the claim could not be applied.
 */
export function registry_claimDeviceName():string{
    hostname_claim(current?.manifest.hostnamePrefix ?? null);
    return hostname_current();
}

/**
 * Take the routes an application has just declared.
 *
 * Called on every SetApplicationInfo, which an SDK re-sends whenever the Core
 * restarts, so the common case is that nothing has changed at all.
 */
export function registry_applyRoutes( routes:ApplicationRoute[] ):void{
    if(JSON.stringify(routes) === JSON.stringify(currentRoutes)) return;
    currentRoutes = routes;

    // No nginx work here, and that is the point of the pass-through: everything
    // under the prefix already reaches the application, so an application adding
    // or moving a page changes only what the menu offers. nginx is regenerated
    // from the manifest's port, which registration settles once.
    if(current) settings_storeApplication(current.path, routes);
}

/**
 * Where the application lives as a whole, or null when none is registered.
 *
 * What the interface falls back to for an application that registered a port
 * but declared no routes of its own.
 */

/**
 * Where the interface should point for a declared route.
 *
 * An application declares its own paths; from outside they live under the
 * pass-through prefix. An absolute URL is left alone — the browser reaches that
 * directly. So is a path on a device with no registered application, which has
 * no pass-through and is served wherever the application put itself.
 */
/** Absolute path to a branding asset the application supplied, or null. */
export function registry_brandingPath( kind:'logo'|'mark' ):string|null{
    return current?.manifest.branding?.[kind] ?? null;
}

/** Theme token overrides the application declared, or null. */
export function registry_brandingColors():Record<string,string>|null{
    return current?.manifest.branding?.colors ?? null;
}

export function registry_baseUrl():string|null{
    return current?.manifest.ui ? APPLICATION_PREFIX+'/' : null;
}

export function registry_publicUrl( route:ApplicationRoute ):string{
    if(!route.path.startsWith('/')) return route.path;
    if(!current?.manifest.ui)       return route.path;
    return route.path === '/' ? APPLICATION_PREFIX+'/' : APPLICATION_PREFIX+route.path;
}

/**
 * Re-read the registered manifest and make routing match it. Called at start.
 *
 * A registration whose manifest has become unreadable — the application was
 * removed, or is mid-update — withdraws the pass-through but keeps the
 * registration, so the device recovers on its own once the application is back
 * rather than needing someone to register it again.
 */
export function registry_load():void{
    const stored = settings_getApplication();
    if(!stored){
        current = null;
        currentRoutes = [];
        if(syncNginxRoutes(null)) reloadNginx();
        applyDeviceName();
        return;
    }

    // The routes the application declared before the last restart. Restored so
    // its paths keep working across a Core restart rather than going dark until
    // it happens to re-declare.
    currentRoutes = stored.routes;

    let manifestRead = false;
    try{
        current = { path: stored.path, manifest: readManifest(stored.path) };
        manifestRead = true;
        console.log('\x1b[32mApplication \''+current.manifest.name+'\' registered from '+stored.path+'\x1b[37m');
    } catch(err:any){
        current = null;
        console.error('\x1b[31mRegistered application at '+stored.path+' is unavailable: '+err.message+'\x1b[37m');
        console.error('\x1b[33mIts routes are withdrawn until it returns; the registration is kept.\x1b[37m');
    }

    /*
     *  The device name is only re-decided when we know what the application
     *  calls itself.
     *
     *  An unreadable manifest is usually an application mid-update, and the
     *  prefix would fall back to 'EDGB' — renaming the device out of the
     *  application's identity over a condition that clears itself on the next
     *  start. A stale suffix after a base board swap is the lesser wrong answer,
     *  and it corrects itself as soon as the manifest reads again.
     */
    if(manifestRead) applyDeviceName();
    else console.log('\x1b[33mDevice name left as \''+hostname_current()+
                     '\' until the application\'s manifest can be read\x1b[37m');

    try{
        if(syncNginxRoutes(current)) reloadNginx();
    } catch(err:any){
        console.error('\x1b[31mCould not apply application routes: '+err.message+'\x1b[37m');
    }
}

/** Perform a lifecycle action the registered application declared it supports. */
export function registry_lifecycle( action:LifecycleAction ):void{
    if(!current) throw new Error('no application is registered');
    runLifecycleAction(current.manifest, action);
}
