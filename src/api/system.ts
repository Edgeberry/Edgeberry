/*
 *  System API
 *  What the device is, and power control. The device's changing state is
 *  state.ts.
 */

import { Router } from 'express';
import { StateManager } from '../stateManager';
import { board_getUUID, board_getVendor, board_getProductName,
         board_getProductId, board_getProductVersion } from '../board';
import { system_restart, system_shutdown, system_getInfo } from '../system';
import { hostname_isManaged } from '../hostname';
import { registry_brandingPath } from '../applicationRegistry';

// The StateManager is here for /system/identify alone — the device announcing
// itself is an indicator interrupt, not a state change.
export type SystemApiDeps = {
    stateManager: StateManager;
};

export function buildSystemRouter({ stateManager }:SystemApiDeps ):Router{
    const router = Router();

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
