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
import path from 'path';

const WEB_UI_PORT = 1208;

export class WebServer {
    private app: express.Application;
    private server: Server | null = null;

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

    /** Expose the underlying Express app for advanced use. */
    public getApp(): express.Application{
        return this.app;
    }

    /** Expose the underlying HTTP server (available after start()). */
    public getHttpServer(): Server | null{
        return this.server;
    }

    private setupRoutes():void{
        const webUiDir = path.join(__dirname, '..', 'public', 'webui');
        this.app.use(express.static(webUiDir));
        this.app.use((_req:Request, res:Response)=>{
            res.sendFile(path.join(webUiDir, 'index.html'));
        });
    }
}
