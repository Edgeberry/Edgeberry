/*
 *  Captive Portal
 *  AP-mode WiFi provisioning feature for the Edgeberry Web Server.
 *
 *  When the device has no saved WiFi connection it starts a hotspot and
 *  this module activates on the running WebServer:
 *   - Exposes /provision/networks and /provision/connect API routes.
 *   - Installs a catch-all redirect so OS captive-portal detection
 *     (Apple, Android, Windows) triggers the popup automatically.
 *
 *  This module serves no pages of its own: the React webUI is the wizard,
 *  and it calls the /provision routes above. Those routes stay mounted
 *  whether or not AP mode is active, so the dashboard can offer the same
 *  'join a network' action at any time.
 *
 *  Everything is deactivated again once the device connects to WiFi.
 *
 *  DNS requirement:
 *  All DNS queries from AP clients must resolve to 10.42.0.1. Add:
 *
 *    /etc/NetworkManager/dnsmasq-shared.d/captive-portal.conf
 *      address=/#/10.42.0.1
 *
 *  NetworkManager picks this up on the next shared connection activation.
 */

import { Request, Response, NextFunction, Router } from 'express';
import { NetworkManager } from './networkManager';
import { WebServer } from './webServer';

const AP_ADDRESS = '10.42.0.1';

export class CaptivePortal {
    private networkManager: NetworkManager;
    private webServer: WebServer;
    private onConnected: (()=> void) | null = null;
    private active: boolean = false;

    constructor( webServer:WebServer, networkManager:NetworkManager ){
        this.webServer = webServer;
        this.networkManager = networkManager;
        this.mountRoutes();
    }

    /** Activate captive portal behaviour (call when entering AP mode). */
    public activate( onConnected:()=> void ):void{
        this.onConnected = onConnected;
        this.active = true;
        console.log('\x1b[33mCaptive Portal: active\x1b[37m');
    }

    /** Deactivate captive portal behaviour (call when leaving AP mode). */
    public deactivate():void{
        this.active = false;
        this.onConnected = null;
        console.log('\x1b[33mCaptive Portal: inactive\x1b[37m');
    }

    private mountRoutes():void{
        const app = this.webServer.getApp();

        // Network provisioning API — always available so the webUI can
        // offer a 'connect to network' feature regardless of AP mode.
        const router = Router();

        router.get('/networks', async (_req:Request, res:Response)=>{
            try{
                try{ await this.networkManager.requestScan(); } catch(_e){}
                await new Promise(r => setTimeout(r, 2000));
                const networks = await this.networkManager.getAccessPoints();
                res.json(networks);
            } catch(err){
                res.status(500).json({ error: 'Failed to retrieve networks' });
            }
        });

        router.post('/connect', async (req:Request, res:Response)=>{
            const { ssid, passphrase } = req.body;
            if(!ssid){
                res.status(400).json({ success:false, error:'Missing ssid' });
                return;
            }
            try{
                const success = await this.networkManager.connectToNetwork(ssid, passphrase || '');
                res.json({ success });
                if(success){
                    setTimeout(()=>{
                        // Capture the callback before deactivating — deactivate()
                        // clears onConnected, so reading it afterwards is always null.
                        const done = this.onConnected;
                        this.deactivate();
                        if(done) done();
                    }, 3000);
                }
            } catch(err){
                res.json({ success:false });
            }
        });

        this.webServer.use('/provision', router);

        // Catch-all: redirect to portal for captive portal detection.
        // The 302 (not 200) triggers the OS captive portal popup on
        // Apple (hotspot-detect.html), Android (generate_204), and
        // Windows (connecttest.txt, ncsi.txt).
        //
        // Requests already addressed to the portal fall through to the static
        // webUI below. Without that check this middleware also redirects '/'
        // and every /assets/* request — including the redirect target itself —
        // which is an infinite loop that serves no page at all. It is
        // registered before express.static because WebServer.setupRoutes()
        // only runs at start(), so falling through is the only correct
        // behaviour here.
        app.use((req:Request, res:Response, next:NextFunction)=>{
            if(!this.active) return next();
            const host = (req.headers.host ?? '').split(':')[0];
            if(host === AP_ADDRESS) return next();
            res.redirect(302, 'http://'+AP_ADDRESS+'/');
        });
    }
}
