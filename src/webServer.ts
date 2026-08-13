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
import { readFileSync } from 'fs';
import path from 'path';
import { registry_brandingColors, registry_brandingPath } from './applicationRegistry';

const WEB_UI_PORT = 1208;

/** Address the device serves on while running as an access point. */
const AP_ADDRESS = '10.42.0.1';

/*
 *  The registered application's branding, as <head> content.
 *
 *  Written into the page the device serves so that the interface's first paint
 *  is already the application's. Fetching the branding instead — which is what
 *  /api/state does — cannot be first: the answer arrives after the page has
 *  been painted, so an application-branded device visibly showed Edgeberry's
 *  logo and colours for the length of a round trip before swapping.
 *
 *  Composed per request rather than cached. The registry is in memory, so
 *  building this is a few string joins, and there is no second copy to
 *  invalidate when an application registers, changes or goes away.
 *
 *  Interpolation is safe by construction: colour tokens and values are checked
 *  against BRANDING_COLORS and COLOR_PATTERN when the manifest is read
 *  (applicationManifest.ts), and the two URLs are constants rather than
 *  anything the manifest supplied.
 */
function brandingHead():string{
    const colors = registry_brandingColors();
    const logo   = registry_brandingPath('logo') ? '/api/application/logo' : null;
    const mark   = registry_brandingPath('mark') ? '/api/application/mark' : null;

    let head = '';

    if(colors){
        // The top bar follows a declared page background, mirroring what the
        // interface derives for itself — see the colours effect in App.tsx.
        const derived:Record<string,string> = { ...colors };
        if(colors.bg) derived['navbar-bg'] = colors.bg;
        if(colors.fg) derived['navbar-fg'] = colors.fg;

        const tokens = Object.entries(derived).map(([token, value])=>`--eb-${token}:${value}`).join(';');
        // Identified so the interface can drop it once it holds the same values
        // itself, rather than leaving a rule behind that outlives its branding.
        head += `<style id="eb-branding">:root{${tokens}}</style>`;
    }

    if(logo) head += `<link rel="preload" as="image" href="${logo}">`;

    /*
     *  The logo cannot travel as CSS: the interface needs the URL before it
     *  renders the <img>, and an effect runs after the first paint. So it goes
     *  as data the shell reads synchronously on its way to that first render.
     */
    const injected = JSON.stringify({ logo, mark, colors }).replace(/</g, '\\u003c');
    head += `<script>window.__EB_BRANDING__=${injected}</script>`;

    return head;
}

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

        const webUiDir  = path.join(__dirname, '..', 'public', 'webui');
        const indexFile = path.join(webUiDir, 'index.html');

        /*
         *  The web interface, carrying the application's branding.
         *
         *  Read per request: the file is a few hundred bytes, and caching it
         *  would need invalidating every time a deploy replaces the bundle
         *  underneath a running device.
         */
        const sendInterface = ( res:Response ) => {
            try{
                const html = readFileSync(indexFile, 'utf8');
                res.type('html').send(html.replace('</head>', brandingHead()+'</head>'));
            } catch(err){
                // Unreadable as text, or no </head> to speak of. The page
                // unbranded is worth more than a 500.
                res.sendFile(indexFile);
            }
        };

        // index:false so '/' reaches the route below rather than being answered
        // with the file straight off disk, which is the one request that most
        // needs the branding in it.
        this.app.use(express.static(webUiDir, { index:false }));
        this.app.get('/', (_req:Request, res:Response)=> sendInterface(res));

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
             *
             *  '/' is routed separately above so it stays out of this: it is
             *  the interface itself, not a path standing in for one.
             */
            res.set('X-Edgeberry-Fallback', '1');
            sendInterface(res);
        });
    }
}
