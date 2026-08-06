/*
 *  Cloud API
 *  Device Hub connection status and configuration — the web-interface
 *  equivalent of `edgeberry --setup`.
 */

import { Router } from 'express';
import { StateManager } from '../stateManager';
import { DeviceHubService } from '../deviceHub';
import { readCertificateInfo } from '../certificates';
import { board_getUUID } from '../board';

export type CloudApiDeps = {
    stateManager: StateManager;
    deviceHub:    DeviceHubService;
};

export function buildCloudRouter({ stateManager, deviceHub }:CloudApiDeps ):Router{
    const router = Router();

    router.get('/', (_req, res) => {
        const connection = stateManager.getState().connection;
        const status     = deviceHub.getStatus();

        res.json({
            ...status,
            deviceId:        status.deviceId ?? board_getUUID(),
            provisionState:  connection.provision,
            connectionState: connection.connection,
            networkState:    connection.network,
            clientStatus:    deviceHub.getClientStatus(),
            // An expired device certificate is the classic invisible cause of a
            // connection that will not come up, so it is surfaced explicitly.
            certificate:     status.certificateFile
                                ? readCertificateInfo(status.certificateFile)
                                : { present: false },
        });
    });

    router.post('/provision', async (req, res) => {
        const { hostName } = req.body ?? {};
        if(typeof hostName !== 'string' || !hostName.trim()){
            res.status(400).json({ error: 'hostName required' });
            return;
        }
        try{
            await deviceHub.provision(hostName.trim(), board_getUUID());
            res.json({ ok: true });
        } catch(err:any){
            // 502: the failure is almost always the hub being unreachable or
            // serving something other than certificates, not a bad request.
            console.error('\x1b[31mDevice Hub provisioning failed: '+err?.message+'\x1b[37m');
            res.status(502).json({ error: err?.message ?? 'Provisioning failed' });
        }
    });

    router.post('/reconnect', async (_req, res) => {
        try{
            await deviceHub.connect();
            res.json({ ok: true });
        } catch(err:any){
            res.status(500).json({ error: err?.message ?? 'Reconnect failed' });
        }
    });

    router.post('/reset', async (_req, res) => {
        try{
            await deviceHub.forgetIdentity();
            res.json({ ok: true });
        } catch(err:any){
            res.status(500).json({ error: err?.message ?? 'Reset failed' });
        }
    });

    return router;
}
