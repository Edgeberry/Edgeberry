/*
 *  State API
 *  The device as the web interface sees it, offered two ways:
 *
 *    GET /api/state          the document, once
 *    GET /api/state/stream   the same document, pushed on every change
 *
 *  Both are served from buildStateView() below, so the interface cannot end up
 *  with two shapes depending on which one delivered — a difference that would
 *  surface as fields flickering, and only on a real device.
 *
 *  Why a stream at all
 *  -------------------
 *  The interface polled every 10 seconds, which is up to 10 seconds between a
 *  WiFi change, an application health change or an AP-mode toggle and the
 *  interface admitting it happened. That lag is most visible exactly when
 *  someone is standing at the device watching it react.
 *
 *  Why the interface still polls as well
 *  -------------------------------------
 *  The stream is added to the poll, not a replacement, for two reasons worth
 *  knowing before anyone "finishes the job" by deleting the timer:
 *
 *   1. Not every field below is state. An application's name, routes and
 *      artwork arrive over D-Bus and are read out of application.ts and
 *      applicationRegistry.ts, neither of which emits an event. A stream-only
 *      interface would show an application's old name until something
 *      unrelated changed the state. The poll sweeps those up.
 *   2. AP mode takes the network down under the browser by design. The poll is
 *      stateless and recovers by itself.
 *
 *  Why server-sent events rather than a WebSocket
 *  ----------------------------------------------
 *  This is one-way, server to client, which is what SSE is. The browser's
 *  EventSource reconnects on its own, so there is no backoff to write; it is an
 *  ordinary express route, so there is no upgrade handling; and a dead client
 *  is just a closed request. The terminal is a WebSocket because it is
 *  genuinely bidirectional — that is the distinction, not inconsistency.
 */

import { Router } from 'express';
import { hostname } from 'os';
import { StateManager, deviceState } from '../stateManager';
import { NetworkManager } from '../networkManager';
import { settings } from '../settingsStore';
import { board_getUUID } from '../board';
import { ApplicationRoute, app_getApplicationInfo, app_getApplicationStatus } from '../application';
import { registry_baseUrl, registry_brandingColors, registry_brandingPath, registry_publicUrl } from '../applicationRegistry';

export type StateApiDeps = {
    stateManager: StateManager;
};

/*
 *  Delay between the last change in a burst and the push.
 *
 *  The StateManager emits once per field written, so a single event — coming
 *  online, an application starting — is a handful of emissions a few
 *  milliseconds apart. Without this each one is a separate frame to every
 *  client, and the interface renders intermediate states that were never true
 *  for longer than an instant.
 */
const COALESCE_MS = 100;

/*
 *  Keepalive comment interval.
 *
 *  A browser that goes away without closing — laptop suspended, WiFi dropped,
 *  the device itself switching to AP mode — leaves a request that looks open
 *  and never errors, because nothing is being written to it that could fail.
 *  A comment line is ignored by EventSource and turns those into the write
 *  failure that closes them.
 */
const KEEPALIVE_MS = 30000;

export function buildStateRouter({ stateManager }:StateApiDeps ):Router{
    const router = Router();

    /*
     *  The state the web interface polls. Deliberately cheap — every field is an
     *  in-memory read — because every open browser asks for it on a timer. The
     *  expensive facts about the device (the AP profile list, certificate
     *  details) have their own routes precisely so they stay out of this one.
     */
    router.get('/state', (_req, res) => {
        res.json(buildStateView(stateManager));
    });

    /*
     *  The same document, pushed.
     *
     *  Each client gets its own listener on the StateManager and drops it when
     *  the request closes. That is a listener per open browser rather than one
     *  for the service, which is the trade for not keeping a client registry
     *  here: on a device serving one or two browsers it is the cheaper of the
     *  two to be correct about. Raise the emitter's max listeners before this
     *  becomes a many-client endpoint.
     */
    router.get('/state/stream', (req, res) => {
        res.set({
            'Content-Type':  'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection':    'keep-alive',
            // nginx buffers proxied responses by default, which would hold
            // events back until the buffer fills. proxy_params disables it for
            // every location already; this says so at the response too, so the
            // route survives an nginx config that forgets.
            'X-Accel-Buffering': 'no',
        });
        res.flushHeaders();

        const send = () => res.write('data: '+JSON.stringify(buildStateView(stateManager))+'\n\n');

        // Open with a snapshot: a client that connects during a quiet spell
        // would otherwise show nothing until the device happens to change, and
        // the first paint is the one people judge.
        send();

        let pending: NodeJS.Timeout | null = null;
        const onState = () => {
            if(pending) return;
            pending = setTimeout(()=>{ pending = null; send(); }, COALESCE_MS);
        };
        stateManager.on('state', onState);

        const keepalive = setInterval(()=>res.write(': keepalive\n\n'), KEEPALIVE_MS);

        req.on('close', ()=>{
            stateManager.off('state', onState);
            if(pending) clearTimeout(pending);
            clearInterval(keepalive);
        });
    });

    return router;
}

export type StateView = {
    system: deviceState['system'] & {
        hostname: string;
        apSsid:   string|null;
    };
    connection: deviceState['connection'] & {
        hubHost: string|null;
    };
    /*
     *  'version' is widened to null: the StateManager declares it a string, but
     *  the value the interface shows is the application's own reported version,
     *  which is absent until the application says so.
     */
    application: Omit<deviceState['application'], 'version'> & {
        name:        string|null;
        description: string|null;
        version:     string|null;
        message:     string|null;
        base:        string|null;
        branding: {
            logo:   string|null;
            mark:   string|null;
            colors: Record<string,string>|null;
        };
        routes: Array<ApplicationRoute & { url:string }>;
    };
};

/**
 * Compose the state document from the StateManager and the modules that hold
 * the parts of it that are not state.
 *
 * Returns a fresh object every call. The StateManager hands out a reference to
 * its own state, so composing in place — which is what this route used to do —
 * wrote these derived fields back into the device's state, and from there into
 * what gets published to the device hub.
 */
export function buildStateView( stateManager:StateManager ):StateView{
    const state = stateManager.getState();
    const uuid  = board_getUUID();

    /*
     *  Two fields derived here rather than held in the StateManager, because
     *  both are constants of this device rather than changing state, and the
     *  alternative endpoints are expensive: /api/network/ap enumerates
     *  NetworkManager profiles over D-Bus, and /api/cloud shells out to openssl.
     */
    const system = {
        ...state.system,
        hostname: hostname(),
        apSsid:   uuid ? NetworkManager.apSsid(uuid) : null,
    };

    const connection = {
        ...state.connection,
        hubHost: settings?.connection?.hostName ?? settings?.provisioning?.hostName ?? null,
    };

    /*
     *  What the application reports about itself, from the two D-Bus calls the
     *  SDKs make: SetApplicationInfo (name/version/description) and
     *  SetApplicationStatus (level/message).
     *
     *  Both live outside the StateManager — info because it is metadata rather
     *  than state, the message because the StateManager lowercases everything
     *  it stores. Grafted on here so the navbar gets them from the state it
     *  already receives, rather than opening a second request.
     */
    const appInfo   = app_getApplicationInfo();
    const appStatus = app_getApplicationStatus();

    const application = {
        ...state.application,
        name:        appInfo?.name ?? null,
        description: appInfo?.description ?? null,
        version:     appInfo?.version ?? null,
        message:     appStatus?.message ?? null,
        // Where the application is reachable as a whole. Null when none is
        // registered, which is what the interface's own fallback is for.
        base:        registry_baseUrl(),
        /*
         *  Where to fetch the application's own artwork, or null to leave the
         *  device's own branding in place. URLs rather than paths: the files
         *  live in the application's directory, which the browser has no way to
         *  reach except through these routes.
         */
        branding: {
            logo:   registry_brandingPath('logo') ? '/api/application/logo' : null,
            mark:   registry_brandingPath('mark') ? '/api/application/mark' : null,
            colors: registry_brandingColors(),
        },
        /*
         *  The views the application offers, already validated and settled by
         *  application.ts.
         *
         *  Each carries the URL the interface should actually open, which is not
         *  the path the application declared: an application names its own
         *  paths, and they are reached from outside under the pass-through
         *  prefix. Resolving it here keeps that mapping in one place rather than
         *  in every consumer.
         */
        routes: (appInfo?.routes ?? []).map(route => ({ ...route, url: registry_publicUrl(route) })),
    };

    return { system, connection, application };
}
