/*
 *  Web Server
 *  Starts an Express HTTP server permanently on port 1208 at application
 *  boot. nginx proxies the public-facing port 80 to this loopback listener,
 *  so the UI is always reachable regardless of network or cloud state.
 *
 *  Other modules mount their routes by calling use() before the server is
 *  started, or at any time afterwards — Express resolves middleware in
 *  registration order at request time.
 */

import express, { Request, Response, NextFunction, Router } from 'express';
import { Server } from 'http';
import path from 'path';

const WEB_UI_PORT = 1208;

/** Address the device serves on while running as an access point. */
const AP_ADDRESS = '10.42.0.1';

export class WebServer {
    private app: express.Application;
    private server: Server | null = null;
    private captivePortalActive = false;

    constructor(){
        this.app = express();
        this.app.use(express.json());
    }

    /** Start the server. Should be called once at application start. */
    public start():void{
        if(this.server) return;
        this.setupRoutes();
        this.server = this.app.listen(WEB_UI_PORT, '127.0.0.1', ()=>{
            console.log('\x1b[32mWeb Server: listening on port '+WEB_UI_PORT+'\x1b[37m');
        });
        this.server.on('error', (err:any)=>{
            console.error('\x1b[31mWeb Server: failed to start — '+err.message+'\x1b[37m');
        });
    }

    /**
     * Mount a Router (or middleware) at the given path prefix.
     * Call this before or after start() — Express resolves middleware
     * in registration order at request time.
     */
    public use(path: string, router: Router):void{
        this.app.use(path, router);
    }

    /** Expose the underlying HTTP server (available after start()). */
    public getHttpServer(): Server | null{
        return this.server;
    }

    /**
     * Turn captive-portal redirection on or off. Driven by access point mode:
     * it is only meaningful while the device is the network clients are on.
     */
    public setCaptivePortalRedirect( active:boolean ):void{
        this.captivePortalActive = active;
        console.log('\x1b[33mCaptive Portal: '+(active ? 'active' : 'inactive')+'\x1b[37m');
    }

    /*
     *  Captive-portal detection
     *
     *  Phones and laptops probe a known URL after joining a network and show
     *  the "sign in to network" popup when the answer is not what they expect.
     *  A 302 (rather than a 200) is what triggers it: Apple fetches
     *  hotspot-detect.html, Android generate_204, Windows connecttest.txt.
     *
     *  Requests already addressed to the portal fall through to the static web
     *  UI below. Without that check this also redirects '/' and every
     *  /assets/* request — including the redirect target itself — which is an
     *  infinite loop that serves no page at all.
     *
     *  Ordering matters: this is registered by start(), which runs after other
     *  modules have mounted their routers, so API calls are answered normally
     *  and only unclaimed paths reach the redirect. It still sits ahead of the
     *  static handler below, so falling through is the only correct behaviour.
     *
     *  Deployment requirement: the popup only appears if every DNS query from
     *  an AP client resolves to this device. NetworkManager's shared-mode
     *  dnsmasq needs:
     *
     *      /etc/NetworkManager/dnsmasq-shared.d/captive-portal.conf
     *        address=/#/10.42.0.1
     *
     *  install.sh writes that file; it is picked up on the next activation of
     *  a shared connection.
     */
    private setupCaptivePortalRedirect():void{
        this.app.use((req:Request, res:Response, next:NextFunction)=>{
            if(!this.captivePortalActive) return next();
            const host = (req.headers.host ?? '').split(':')[0];
            if(host === AP_ADDRESS) return next();
            res.redirect(302, 'http://'+AP_ADDRESS+'/');
        });
    }

    private setupRoutes():void{
        this.setupCaptivePortalRedirect();

        const webUiDir = path.join(__dirname, '..', 'public', 'webui');
        this.app.use(express.static(webUiDir));
        this.app.use((_req:Request, res:Response)=>{
            /*
             *  Mark the response as the single-page-app fallback rather than a
             *  resource that exists.
             *
             *  nginx sends every unclaimed path here, so a path that no
             *  application has registered a route for — /dashboard with no
             *  routes.d entry, say — answers 200 with this page. The web
             *  interface frames that path, so without a way to tell the
             *  fallback apart from a real application it frames itself, and a
             *  missing application looks like the interface repeating inside
             *  itself instead of like an error.
             */
            res.set('X-Edgeberry-Fallback', '1');
            res.sendFile(path.join(webUiDir, 'index.html'));
        });
    }
}
