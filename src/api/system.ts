/*
 *  System API
 *  Device state and power control.
 */

import { Router } from 'express';
import { hostname } from 'os';
import { StateManager } from '../stateManager';
import { NetworkManager } from '../networkManager';
import { settings } from '../settingsStore';
import { board_getUUID } from '../board';
import { system_restart, system_shutdown } from '../system';

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

        res.json(state);
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
