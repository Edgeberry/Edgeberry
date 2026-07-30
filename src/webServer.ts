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
<style>\
*{margin:0;padding:0;box-sizing:border-box}\
body{\
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;\
  background:#f5f5f5;color:#222;min-height:100vh;\
  display:flex;align-items:center;justify-content:center;padding:16px;\
}\
.card{background:#fff;border-radius:12px;box-shadow:0 2px 16px rgba(0,0,0,.08);\
  width:100%;max-width:400px;padding:32px;text-align:center;}\
h1{font-size:22px;font-weight:700;margin-bottom:8px;}\
p{color:#888;font-size:14px;}\
</style>\
</head>\
<body>\
<div class="card">\
  <h1>Edgeberry</h1>\
  <p>Device is running.</p>\
</div>\
</body>\
</html>';
}
