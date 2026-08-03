/*
 *  Web Server
 *  Starts an Express HTTP server permanently on port 1208 at application
 *  boot. nginx proxies the public-facing port 80 to this loopback listener,
 *  so the UI is always reachable regardless of network or cloud state.
 *
 *  Other modules (e.g. CaptivePortal) can mount additional routes by
 *  calling use() before the server is started, or at any time afterwards
 *  since Express resolves middleware in registration order.
 */

import express, { Request, Response, Router } from 'express';
import { Server } from 'http';

const WEB_UI_PORT = 1208;

export class WebServer {
    private app: express.Application;
    private server: Server | null = null;

    constructor(){
        this.app = express();
        this.app.use(express.json());
        this.setupRoutes();
    }

    /** Start the server. Should be called once at application start. */
    public start():void{
        if(this.server) return;
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

    /** Expose the underlying Express app for advanced use. */
    public getApp(): express.Application{
        return this.app;
    }

    private setupRoutes():void{
        this.app.get('/', (_req:Request, res:Response)=>{
            res.type('html').send(placeholderPage());
        });
    }
}

/*
 *  Placeholder Page
 *  Served at the root until the webUI application is installed and
 *  nginx is configured to serve static assets instead.
 */
function placeholderPage():string{
    return '<!DOCTYPE html>\
<html lang="en">\
<head>\
<meta charset="UTF-8">\
<meta name="viewport" content="width=device-width, initial-scale=1.0">\
<title>Edgeberry</title>\
<link rel="stylesheet" href="/theme/tokens.css">\
<link rel="stylesheet" href="/theme/brand.css">\
<link rel="icon" href="/theme/logo/symbol.svg" type="image/svg+xml">\
<style>\
*{margin:0;padding:0;box-sizing:border-box}\
body{\
  font-family:var(--eb-font);\
  background:var(--eb-bg);color:var(--eb-fg);min-height:100vh;\
  display:flex;align-items:center;justify-content:center;padding:16px;\
}\
.card{background:var(--eb-bg);border:1px solid var(--eb-line);border-top:4px solid var(--eb-accent);border-radius:12px;box-shadow:0 2px 16px rgba(0,0,0,.08);\
  width:100%;max-width:400px;padding:32px;text-align:center;}\
.logo{width:180px;max-width:100%;height:auto;margin-bottom:24px;}\
h1{font-size:22px;font-weight:700;margin-bottom:8px;}\
p{color:var(--eb-fg);font-size:14px;}\
</style>\
</head>\
<body>\
<div class="card">\
  <img class="logo" src="/theme/logo/logo.svg" alt="Edgeberry">\
  <h1>Device Software</h1>\
  <p>Device is running.</p>\
</div>\
</body>\
</html>';
}
