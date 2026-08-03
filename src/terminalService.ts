/*
 *  Terminal Service
 *  Spawns a PTY (bash) per WebSocket connection and relays data bidirectionally.
 *  WebSocket path: /ws/terminal
 *  Upgrade is handled by attaching to the shared HTTP server after start().
 */

import { WebSocketServer, WebSocket } from 'ws';
import * as pty from 'node-pty';
import { Server } from 'http';

export function startTerminalService( httpServer: Server ):void{
    const wss = new WebSocketServer({ noServer: true });

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
