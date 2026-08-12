/*
 *  System API
 *  Device state and power control.
 */

import { Router } from 'express';
import { hostname } from 'os';
import { StateManager } from '../stateManager';
import { NetworkManager } from '../networkManager';
import { settings } from '../settingsStore';
import { board_getUUID, board_getVendor, board_getProductName,
         board_getProductId, board_getProductVersion } from '../board';
import { system_restart, system_shutdown, system_getInfo } from '../system';
import { hostname_isManaged } from '../hostname';
import { app_getApplicationInfo, app_getApplicationStatus } from '../application';
import { registry_baseUrl, registry_brandingColors, registry_brandingPath, registry_publicUrl } from '../applicationRegistry';

export type SystemApiDeps = {
    stateManager: StateManager;
};

export function buildSystemRouter({ stateManager }:SystemApiDeps ):Router{
    const router = Router();

    /*
     *  The state the web interface polls.
     *
     *  Two fields are derived here rather than held in the StateManager, because
     *  both are constants of this device rather than changing state, and the
     *  alternative endpoints are expensive: /api/network/ap enumerates
     *  NetworkManager profiles over D-Bus, and /api/cloud shells out to openssl.
     *  The navbar polls this route every 10 seconds.
     */
    router.get('/state', (_req, res) => {
        const state = stateManager.getState() as any;
        const uuid  = board_getUUID();

        state.system = {
            ...state.system,
            hostname: hostname(),
            apSsid:   uuid ? NetworkManager.apSsid(uuid) : null,
        };
        state.connection = {
            ...state.connection,
            hubHost: settings?.connection?.hostName ?? settings?.provisioning?.hostName ?? null,
        };

        /*
         *  What the application reports about itself, from the two D-Bus calls
         *  the SDKs make: SetApplicationInfo (name/version/description) and
         *  SetApplicationStatus (level/message).
         *
         *  Both live outside the StateManager — info because it is metadata
         *  rather than state, the message because the StateManager lowercases
         *  everything it stores. Grafted on here so the navbar gets them from
         *  the route it already polls, rather than opening a second request.
         *
         *  'version' was declared on the application state but never written by
         *  anything; the application's own reported version is what it was for.
         */
        const appInfo   = app_getApplicationInfo();
        const appStatus = app_getApplicationStatus();
        state.application = {
            ...state.application,
            name:        appInfo?.name ?? null,
            description: appInfo?.description ?? null,
            version:     appInfo?.version ?? null,
            message:     appStatus?.message ?? null,
            /*
             *  The views the application offers, already validated and settled
             *  by application.ts.
             *
             *  Each carries the URL the interface should actually open, which is
             *  not the path the application declared: an application names its
             *  own paths, and they are reached from outside under the
             *  pass-through prefix. Resolving it here keeps that mapping in one
             *  place rather than in every consumer of this route.
             */
            // Where the application is reachable as a whole. Null when none is
            // registered, which is what the interface's own fallback is for.
            base:        registry_baseUrl(),
            /*
             *  Where to fetch the application's own artwork, or null to leave
             *  the device's own branding in place. URLs rather than paths: the
             *  files live in the application's directory, which the browser has
             *  no way to reach except through the routes below.
             */
            branding: {
                logo: registry_brandingPath('logo') ? '/api/application/logo' : null,
                mark: registry_brandingPath('mark') ? '/api/application/mark' : null,
                colors: registry_brandingColors(),
            },
            routes:      (appInfo?.routes ?? []).map(route => ({ ...route, url: registry_publicUrl(route) })),
        };

        res.json(state);
    });

    /*
     *  Everything the device knows about itself.
     *
     *  Deliberately not part of /api/state: this is opened by hand and read
     *  once, where /state is polled every 10 seconds by every open browser.
     *  The two halves come from two different machines — the Linux host and
     *  the Edgeberry board on its header — and are kept apart here for the
     *  same reason system.ts and board.ts are separate.
     */
    router.get('/system/info', (_req, res) => {
        res.json({
            system: {
                ...system_getInfo(),
                /*
                 *  Whether the device name is still Edgeberry's to set.
                 *
                 *  Grafted on here rather than held in system.ts, which is about
                 *  the Linux host — this is about a decision Edgeberry made.
                 *  Surfacing it is not decoration: renaming a device by hand
                 *  makes Edgeberry stop naming it, permanently and silently, and
                 *  without this the only trace is one log line from a boot
                 *  months ago. It is the answer to 'why didn't my application's
                 *  name take?'.
                 */
                hostnameManaged: hostname_isManaged(),
            },
            board: {
                vendor:  board_getVendor(),
                product: board_getProductName(),
                // Two bytes, conventionally written as the hex the EEPROM holds.
                id:      board_getProductId()?.replace(/\0.*$/g,'').trim() ?? null,
                version: board_getProductVersion(),
                uuid:    board_getUUID(),
            },
        });
    });

    /*
     *  The registered application's artwork.
     *
     *  Served by the device rather than proxied, because these are read at
     *  install time from the application's directory and are not part of
     *  whatever it serves on its own port — an application need not run at all
     *  for the interface to carry its branding.
     *
     *  sendFile handles content type, ETag and Last-Modified, so an updated
     *  logo is picked up without the URL having to change.
     */
    const sendBranding = ( kind:'logo'|'mark' ) => (_req:any, res:any) => {
        const file = registry_brandingPath(kind);
        if(!file) return res.status(404).json({ error: `No application ${kind}` });
        res.sendFile(file, (err:any) => {
            // The manifest was checked at registration, so getting here means
            // the application removed the file afterwards.
            if(err && !res.headersSent) res.status(404).json({ error: `Application ${kind} is unavailable` });
        });
    };

    router.get('/application/logo', sendBranding('logo'));
    router.get('/application/mark', sendBranding('mark'));

    // Power actions answer before acting: the reboot is scheduled a moment
    // later so the response reaches the caller before the device goes down.
    router.post('/system/reboot',   (_req, res) => { system_restart();  res.json({ ok: true }); });
    router.post('/system/shutdown', (_req, res) => { system_shutdown(); res.json({ ok: true }); });

    router.post('/system/identify', (_req, res) => {
        stateManager.interruptIndicators('identify');
        res.json({ ok: true });
    });

    return router;
}
