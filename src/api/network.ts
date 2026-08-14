/*
 *  Network API
 *  WiFi status, joining a network, saved-profile IP configuration, interfaces,
 *  and the access point toggle.
 *
 *  One set of routes serves both the AP-mode setup wizard and the dashboard —
 *  they are the same actions, performed at different moments.
 */

import { Router } from 'express';
import { networkInterfaces } from 'os';
import { NetworkManager } from '../networkManager';
import { ApModeService } from '../apMode';
import { board_getUUID } from '../board';

export type NetworkApiDeps = {
    networkManager: NetworkManager;
    apMode:         ApModeService;
};

// A scan needs a moment between asking the radio and reading the results back.
const SCAN_SETTLE_MS = 2000;

export function buildNetworkRouter({ networkManager, apMode }:NetworkApiDeps ):Router{
    const router = Router();

    router.get('/wifi/active', async (_req, res) => {
        try{
            res.json({ ssid: await networkManager.getActiveWifiSsid() ?? null });
        } catch(_err){
            res.json({ ssid: null });
        }
    });

    router.get('/wifi', async (_req, res) => {
        try{
            // A failed scan is not fatal — NetworkManager still knows about the
            // access points it saw last time.
            try{ await networkManager.requestScan(); } catch(_err){}
            await new Promise(resolve => setTimeout(resolve, SCAN_SETTLE_MS));

            const [available, saved, active] = await Promise.all([
                networkManager.getAccessPoints(),
                networkManager.getSavedWifiNetworks(),
                networkManager.getActiveWifiSsid(),
            ]);
            res.json({ available, saved, active });
        } catch(_err){
            res.status(500).json({ error: 'Failed to retrieve WiFi data' });
        }
    });

    /**
     * Join a wireless network.
     *
     * Answers with `{ success }` rather than an HTTP error on a failed join:
     * a wrong passphrase is an expected outcome the interface reports inline,
     * not a fault in the request.
     *
     * A client that submitted this from the setup interface will not see that
     * answer: the radio cannot host the access point and join a network at the
     * same time, so NetworkManager drops the access point — and the connection
     * carrying this request with it — the moment the join activates. Nothing can
     * be done about that from here; delaying the reply does not help, because
     * the access point is already gone by the time there is a result to send.
     * The setup interface currently reports that dropped request as a failed
     * join, which is wrong — it has to infer success from the device coming up
     * on the new network instead.
     */
    router.post('/wifi/connect', async (req, res) => {
        const { ssid, passphrase } = req.body ?? {};
        if(typeof ssid !== 'string' || !ssid){
            res.status(400).json({ success: false, error: 'ssid required' });
            return;
        }
        try{
            const success = await networkManager.connectToNetwork(ssid, passphrase || '');
            res.json({ success });

            // Joining a network is how setup finishes. The access point is
            // already down by now; this settles the state that tracked it and
            // brings the hub connection up.
            if(success && apMode.isActive()) await apMode.exit();
        } catch(_err){
            res.json({ success: false });
        }
    });

    router.post('/wifi/ipconfig', async (req, res) => {
        const { ssid, mode, address, prefix, gateway, dns } = req.body ?? {};
        if(!ssid || !mode){
            res.status(400).json({ error: 'ssid and mode required' });
            return;
        }
        try{
            await networkManager.setWifiIpConfig(
                ssid, mode, address,
                prefix !== undefined ? Number(prefix) : undefined,
                gateway, dns,
            );
            res.json({ ok: true });
        } catch(err:any){
            res.status(500).json({ error: err?.message ?? 'Failed to update IP config' });
        }
    });

    router.get('/interfaces', (_req, res) => {
        const result = Object.entries(networkInterfaces()).map(([name, addresses]) => ({
            name,
            addresses: (addresses ?? []).map(a => ({
                address:  a.address,
                family:   a.family,
                netmask:  a.netmask,
                mac:      a.mac,
                internal: a.internal,
                cidr:     a.cidr,
            })),
        }));
        res.json(result);
    });

    /*
     *  Access point mode
     */

    router.get('/ap', async (_req, res) => {
        res.json({
            active:  apMode.isActive(),
            ssid:    apMode.apSsid(board_getUUID()),
            // Reported so the interface can lock the switch rather than let the
            // operator strand the device and get only an error beep for it.
            canExit: await apMode.canExit(),
        });
    });

    router.post('/ap', async (req, res) => {
        const { enabled } = req.body ?? {};
        if(typeof enabled !== 'boolean'){
            res.status(400).json({ error: 'enabled (boolean) required' });
            return;
        }
        if(enabled === apMode.isActive()){
            res.json({ ok: true, unchanged: true });
            return;
        }
        if(!enabled && !await apMode.canExit()){
            res.status(409).json({ error: 'No saved WiFi network to return to' });
            return;
        }

        // Answer before acting. Both directions tear down the interface this
        // request arrived on, so a response sent afterwards never lands — the
        // caller would only see a dropped connection.
        res.json({ ok: true });
        setTimeout(() => { apMode.toggle(board_getUUID()); }, 1000);
    });

    return router;
}
