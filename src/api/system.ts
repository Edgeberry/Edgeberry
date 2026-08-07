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
import { app_getApplicationInfo, app_getApplicationStatus } from '../application';

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
            apSsid:   uuid ? NetworkManager.apSsidFromUUID(uuid) : null,
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
            system: system_getInfo(),
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
