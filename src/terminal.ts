/*
 *  Terminal Service
 *  Backs the Terminal panel in the web interface, and nothing else. Spawns a
 *  PTY (bash) per WebSocket connection on /ws/terminal and relays data both
 *  ways. Two message types in each direction: 'data' and, inbound, 'resize'.
 *
 *  This attaches to the HTTP server the web interface is already served from
 *  rather than binding a port of its own, so it can only be started after
 *  WebServer.start() has created that server.
 */

import { WebSocketServer, WebSocket } from 'ws';
import * as pty from 'node-pty';
import { Server } from 'http';

export function startTerminalService( httpServer: Server ):void{
    const wss = new WebSocketServer({ noServer: true });

    // 'upgrade' handlers are additive: every registered handler sees every
    // upgrade request. This one destroys sockets on paths it does not own, so a
    // second WebSocket endpoint added elsewhere would have its handshake killed
    // here. Give this branch a path check that lets other paths pass before
    // adding one.
    httpServer.on('upgrade', (req, socket, head)=>{
        if(req.url !== '/ws/terminal'){
            socket.destroy();
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws)=>{
            wss.emit('connection', ws, req);
        });
    });

    wss.on('connection', (ws: WebSocket)=>{
        const shell = process.env.SHELL ?? '/bin/bash';
        const ptyProcess = pty.spawn(shell, [], {
            name:  'xterm-256color',
            cols:  80,
            rows:  24,
            cwd:   process.env.HOME ?? '/',
            env:   process.env as { [key: string]: string },
        });

        ptyProcess.onData((data: string)=>{
            if(ws.readyState === WebSocket.OPEN)
                ws.send(JSON.stringify({ type: 'data', data }));
        });

        ptyProcess.onExit(()=>{
            if(ws.readyState === WebSocket.OPEN)
                ws.send(JSON.stringify({ type: 'exit' }));
            ws.close();
        });

        ws.on('message', (msg: Buffer)=>{
            try{
                const parsed = JSON.parse(msg.toString());
                if(parsed.type === 'data'){
                    ptyProcess.write(parsed.data);
                } else if(parsed.type === 'resize'){
                    ptyProcess.resize(parsed.cols, parsed.rows);
                }
            } catch(_e){}
        });

        ws.on('close', ()=>{ try{ ptyProcess.kill(); } catch(_e){} });

        console.log('\x1b[32mTerminal: PTY session opened\x1b[37m');
    });

    console.log('\x1b[32mTerminal: WebSocket service attached to /ws/terminal\x1b[37m');
}
