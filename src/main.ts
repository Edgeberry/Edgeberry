/*
 *  Edgeberry device software
 *  An application for using your Raspberry Pi as an edge device for your IoT project.
 * 
 *  Copyright 2024 Sanne 'SpuQ' Santens
 * 
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import { readFileSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir, networkInterfaces } from "os";
import { spawnSync } from "child_process";
import path from "path";
import { connect, MqttClient, IClientOptions } from "mqtt";
import { Router as ExpressRouter } from 'express';
import { StateManager } from "./stateManager";
// Dashboard cloud client
import { EdgeberryDeviceHubClient } from "@edgeberry/devicehub-device-client";
// System features
import { system_board_getProductName, system_board_getProductVersion, system_board_getUUID, system_getApplicationInfo, system_getPlatform, system_button, system_restart, system_shutdown } from "./systemService";
// Network Manager (WiFi provisioning)
import { NetworkManager } from './networkManager';
// Web Server (permanent UI on port 1208)
import { WebServer } from './webServer';
// Captive Portal (AP-mode WiFi provisioning feature)
import { CaptivePortal } from './captivePortal';
// Direct Methods
import { initializeDirectMethodAPI } from "./directMethods";
// Persistent settings
import { settings, settings_deleteConnectionParameters, settings_storeConnectionParameters, settings_storeProvisioningParameters } from './settingsStore';
// Device Hub onboarding (web-interface equivalent of `edgeberry --setup`)
import { fetchProvisioningCertificates, readCertificateInfo } from './deviceHubSetup';
// Terminal Service (PTY over WebSocket)
import { startTerminalService } from './terminalService';
// Commandline Interface (for inter-process communication)
import './dbusInterface';
import { emitCloudMessage, emitButtonEvent, emitStateUpdate } from './dbusInterface';

/* State Manager */
export const stateManager = new StateManager();
stateManager.updateSystemState('state', 'starting');

/* Network Manager */
export const networkManager = new NetworkManager();

/* Web Server */
const webServer = new WebServer();

/* API — minimal state endpoint used by the web UI */
const apiRouter = ExpressRouter();
apiRouter.get('/state', (_req, res) => {
    const state = stateManager.getState() as any;
    // apSsid is derived from the board UUID, so it is known whether or not the
    // AP is up. Served here because the webUI polls this endpoint anyway —
    // /api/network/ap walks every NetworkManager profile over D-Bus and is far
    // too expensive for the navbar's poll interval.
    const uuid = system_board_getUUID();
    state.system = {
        ...state.system,
        hostname: require('os').hostname(),
        apSsid:   uuid ? NetworkManager.apSsidFromUUID(uuid) : null,
    };
    // Served here rather than from /api/cloud because the navbar polls this
    // endpoint — /api/cloud shells out to openssl to read the certificate.
    state.connection = {
        ...state.connection,
        hubHost: settings?.connection?.hostName ?? settings?.provisioning?.hostName ?? null,
    };
    res.json(state);
});
apiRouter.post('/system/reboot',    (_req, res) => { system_restart();  res.json({ ok: true }); });
apiRouter.post('/system/shutdown',  (_req, res) => { system_shutdown(); res.json({ ok: true }); });
apiRouter.post('/system/identify',  (_req, res) => { stateManager.interruptIndicators('identify'); res.json({ ok: true }); });
apiRouter.get('/network/wifi/active', async (_req, res) => {
    try {
        const ssid = await networkManager.getActiveWifiSsid();
        res.json({ ssid: ssid ?? null });
    } catch(_err) {
        res.json({ ssid: null });
    }
});
apiRouter.get('/network/wifi', async (_req, res) => {
    try {
        try { await networkManager.requestScan(); } catch(_e) {}
        await new Promise(r => setTimeout(r, 2000));
        const [available, saved, active] = await Promise.all([
            networkManager.getAccessPoints(),
            networkManager.getSavedWifiNetworks(),
            networkManager.getActiveWifiSsid(),
        ]);
        res.json({ available, saved, active });
    } catch(err) {
        res.status(500).json({ error: 'Failed to retrieve WiFi data' });
    }
});
apiRouter.post('/network/wifi/ipconfig', async (req, res) => {
    const { ssid, mode, address, prefix, gateway, dns } = req.body ?? {};
    if(!ssid || !mode) { res.status(400).json({ error: 'ssid and mode required' }); return; }
    try {
        await networkManager.setWifiIpConfig(ssid, mode, address, prefix !== undefined ? Number(prefix) : undefined, gateway, dns);
        res.json({ ok: true });
    } catch(err:any) {
        res.status(500).json({ error: err?.message ?? 'Failed to update IP config' });
    }
});
apiRouter.get('/cloud', (_req, res) => {
    const conn  = stateManager.getState().connection;
    // hostName comes from whichever block is authoritative: once provisioned
    // the connection block is what the client actually dials.
    const hostName = settings?.connection?.hostName ?? settings?.provisioning?.hostName ?? null;
    let clientStatus:any = null;
    try { clientStatus = cloud ? cloud.getClientStatus() : null; } catch(_e) {}
    res.json({
        hostName,
        deviceId:        settings?.connection?.deviceId ?? settings?.provisioning?.clientId ?? system_board_getUUID(),
        configured:      Boolean(settings?.provisioning || settings?.connection),
        provisioned:     Boolean(settings?.connection),
        provisionState:  conn.provision,
        connectionState: conn.connection,
        networkState:    conn.network,
        clientStatus,
        certificate:     settings?.connection?.certificateFile ? readCertificateInfo(settings.connection.certificateFile) : { present:false },
    });
});
apiRouter.post('/cloud/provision', async (req, res) => {
    const { hostName } = req.body ?? {};
    if(typeof hostName !== 'string' || !hostName.trim()){
        res.status(400).json({ error: 'hostName required' }); return;
    }
    try{
        await provisionToDeviceHub(hostName.trim());
        res.json({ ok: true });
    } catch(err:any){
        console.error('\x1b[31mDevice Hub provisioning failed: '+err?.message+'\x1b[37m');
        res.status(502).json({ error: err?.message ?? 'Provisioning failed' });
    }
});
apiRouter.post('/cloud/reconnect', async (_req, res) => {
    try{
        await connectToDeviceHub();
        res.json({ ok: true });
    } catch(err:any){
        res.status(500).json({ error: err?.message ?? 'Reconnect failed' });
    }
});
apiRouter.post('/cloud/reset', async (_req, res) => {
    try{
        await resetDeviceHubConnection();
        res.json({ ok: true });
    } catch(err:any){
        res.status(500).json({ error: err?.message ?? 'Reset failed' });
    }
});
apiRouter.get('/network/ap', async (_req, res) => {
    const uuid = system_board_getUUID();
    let canExit = false;
    try { canExit = await networkManager.hasSavedWifiConnection(); } catch(_e) {}
    res.json({
        active:  stateManager.getState().connection.wifi === 'ap_mode',
        ssid:    uuid ? NetworkManager.apSsidFromUUID(uuid) : null,
        canExit,
    });
});
apiRouter.post('/network/ap', async (req, res) => {
    const { enabled } = req.body ?? {};
    if(typeof enabled !== 'boolean'){ res.status(400).json({ error: 'enabled (boolean) required' }); return; }

    const inApMode = stateManager.getState().connection.wifi === 'ap_mode';
    if(enabled === inApMode){ res.json({ ok: true, unchanged: true }); return; }

    if(!enabled){
        // Refuse to strand the device: leaving AP mode needs somewhere to go.
        let canExit = false;
        try { canExit = await networkManager.hasSavedWifiConnection(); } catch(_e) {}
        if(!canExit){ res.status(409).json({ error: 'No saved WiFi network to return to' }); return; }
    }

    // Respond before acting. Both transitions tear down the interface this
    // request arrived on, so the response has to be flushed first — otherwise
    // the caller only ever sees a dropped connection.
    res.json({ ok: true });
    setTimeout(async () => {
        if(enabled){
            try { await networkManager.disconnect(); } catch(_e) {}
            await enterApMode();
        } else {
            await exitApMode();
        }
    }, 1000);
});
apiRouter.get('/network/interfaces', (_req, res) => {
    const raw = networkInterfaces();
    const result = Object.entries(raw).map(([name, addrs]) => ({
        name,
        addresses: (addrs ?? []).map(a => ({
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
webServer.use('/api', apiRouter);

/* Captive Portal (AP-mode feature mounted on the web server) */
const captivePortal = new CaptivePortal(webServer, networkManager);

/* Device Hub */
export let cloud: EdgeberryDeviceHubClient;
let provisioningClient: MqttClient | null = null;
let cloudConnectInProgress = false;

// Utility functions for provisioning
function openssl(args: string[], input?: string): { code: number, out: string, err: string } {
  const res = spawnSync('openssl', args, { input, encoding: 'utf8' });
  return { code: res.status ?? 1, out: res.stdout || '', err: res.stderr || '' };
}

function genKeyAndCsr(deviceId: string): { keyPem: string; csrPem: string } {
  const tmp = mkdtempSync(path.join(tmpdir(), 'edgeberry-device-'));
  const keyPath = path.join(tmp, `${deviceId}.key`);
  const csrPath = path.join(tmp, `${deviceId}.csr`);
  let r = openssl(['genrsa', '-out', keyPath, '2048']);
  if (r.code !== 0) throw new Error(`openssl genrsa failed: ${r.err || r.out}`);
  r = openssl(['req', '-new', '-key', keyPath, '-subj', `/CN=${deviceId}`, '-out', csrPath]);
  if (r.code !== 0) throw new Error(`openssl req -new failed: ${r.err || r.out}`);
  const keyPem = readFileSync(keyPath, 'utf8');
  const csrPem = readFileSync(csrPath, 'utf8');
  return { keyPem, csrPem };
}

async function initialize():Promise<void>{
    // initialize system state
    try{
        // Update the hardware platform
        stateManager.updateSystemState('platform', (await system_getPlatform()) );
        // Update the (board) Hardware info
        stateManager.updateSystemState("board", system_board_getProductName() );
        stateManager.updateSystemState("board_version", system_board_getProductVersion() );
        stateManager.updateSystemState("uuid", system_board_getUUID() );
        // Update the app info
        stateManager.updateSystemState('version', (await system_getApplicationInfo())?.version );
    }
    catch(err){}

    // Check if the board ID is the same as the client ID
    // If this is not the case, remove the previous ID settings
    const boardId = system_board_getUUID();
    if( boardId !== null && boardId !== settings?.connection?.deviceId ){
        console.error('\x1b[33mWarning: The board UUID does not match the Dashboard ID!\x1b[37m');
        console.log('\x1b[90mBoard ID: '+boardId+'\x1b[37m');
        console.log('\x1b[90mClient ID: '+settings?.connection?.deviceId+'\x1b[37m');
        // Delete the connection settings
        console.log('\x1b[33mDeleting connection parameters\x1b[37m');
        settings_deleteConnectionParameters();
        // Change the provisioning client ID to the board ID
        console.error('\x1b[90m\tUpdating provisioning clientID to the board UUID\x1b[37m');
        if (!settings.provisioning) {
            settings.provisioning = {};
        }
        settings.provisioning.clientId = boardId.toString();
        // Save the provisioning parameters
        // settings_storeProvisioningParameters( settings.provisioning ); --- this currently erases cert/key files -_-
    }

    // Start the web UI server permanently on port 1208 so it is always
    // reachable via nginx regardless of network/cloud connectivity state.
    webServer.start();
    const httpServer = webServer.getHttpServer();
    if(httpServer) startTerminalService(httpServer);

    // Keep connection.wifi state accurate by subscribing to NM device state.
    // Guard: never overwrite 'ap_mode' — AP mode transitions manage that themselves.
    networkManager.subscribeToWifiState((state) => {
        if(stateManager.getState().connection.wifi !== 'ap_mode')
            stateManager.updateConnectionState('wifi', state);
    }).catch(() => {});

    // Check for saved WiFi connection before proceeding to Device Hub.
    // Wrapped in a timeout: if NetworkManager is not available (e.g. device
    // uses dhcpcd instead), the D-Bus call may hang indefinitely.
    try{
        // Clear AP profiles orphaned by an unclean shutdown first — an orphan
        // is indistinguishable from a configured network to the check below,
        // and would permanently suppress automatic AP mode.
        await Promise.race([
            networkManager.deleteOrphanedApProfiles(),
            new Promise<void>((resolve)=> setTimeout(resolve, 5000))
        ]);
        const hasWifi = await Promise.race([
            networkManager.hasSavedWifiConnection(),
            new Promise<null>((_, reject)=> setTimeout(()=> reject(new Error('WiFi check timed out')), 5000))
        ]);
        if(hasWifi === false){
            // No WiFi configured - enter AP mode for provisioning
            await enterApMode();
            return;
        }
    } catch(err){
        console.error('\x1b[31mWiFi check failed: '+err+'\x1b[37m');
    }

    // WiFi is available - proceed with Device Hub connectivity
    await connectToDeviceHub();
}

/*
 *  WiFi Access Point Mode
 *  Functions for entering and exiting AP mode for WiFi provisioning.
 */

export async function enterApMode():Promise<void>{
    const boardId = system_board_getUUID();
    if(!boardId){
        console.error('\x1b[31mCannot start AP: no board UUID\x1b[37m');
        return;
    }
    try{
        await networkManager.startAccessPoint(boardId);
        stateManager.updateConnectionState('wifi', 'ap_mode');
        console.log('\x1b[33mDevice is in Access Point mode for WiFi provisioning\x1b[37m');
        // Activate captive portal behaviour on the running web server
        captivePortal.activate(()=>{
            // onConnected: called after successful WiFi configuration
            exitApMode();
        });
    } catch(err){
        console.error('\x1b[31mFailed to start Access Point: '+err+'\x1b[37m');
    }
}

export async function exitApMode():Promise<void>{
    try{
        // Check if there's a saved WiFi connection to return to
        const hasWifi = await networkManager.hasSavedWifiConnection();
        if(!hasWifi){
            // Cannot exit AP mode without a saved network
            stateManager.interruptIndicators('ap_error');
            console.error('\x1b[31mCannot exit AP mode: no saved WiFi connection\x1b[37m');
            return;
        }
        // Deactivate captive portal behaviour (web server keeps running)
        captivePortal.deactivate();
        await networkManager.stopAccessPoint();
        stateManager.updateConnectionState('wifi', 'disconnected');
        console.log('\x1b[33mExited AP mode, reconnecting to WiFi...\x1b[37m');

        // Wait until the WiFi chip has fully left AP mode and is ready to
        // accept a new connection. A fixed sleep is unreliable — poll instead.
        const ready = await networkManager.waitForWifiDeviceReady();
        if(!ready){
            console.error('\x1b[31mWiFi device did not become ready after AP teardown\x1b[37m');
            return;
        }

        // Explicitly activate the saved WiFi connection
        const reconnected = await networkManager.activateSavedWifiConnection();
        if(reconnected){
            stateManager.updateConnectionState('wifi', 'connected');
            console.log('\x1b[32mWiFi reconnected, resuming normal operation\x1b[37m');
            // If cloud client exists, MQTT.js built-in reconnection
            // handles reconnecting automatically when WiFi returns.
            // Only call connectToDeviceHub() if client doesn't exist yet.
            await connectToDeviceHub();
        } else {
            console.error('\x1b[31mFailed to reconnect to WiFi after exiting AP mode\x1b[37m');
        }
    } catch(err){
        console.error('\x1b[31mFailed to exit AP mode: '+err+'\x1b[37m');
    }
}

/*
 *  Device Hub Connectivity
 */

export async function connectToDeviceHub():Promise<void>{
    if(cloudConnectInProgress) return;
    cloudConnectInProgress = true;
    try{ await _connectToDeviceHub(); } finally{ cloudConnectInProgress = false; }
}

/*
 *  Point the device at a Device Hub and provision against it.
 *  Web-interface equivalent of `edgeberry --setup`: fetch the hub's
 *  provisioning certificates, store them, discard any existing identity and
 *  run the CSR exchange again.
 */
export async function provisionToDeviceHub( hostName:string ):Promise<void>{
    const certs = await fetchProvisioningCertificates(hostName);
    console.log('\x1b[32mFetched provisioning certificates from '+hostName+' via '+certs.via+'\x1b[37m');

    const clientId = system_board_getUUID() ?? settings?.provisioning?.clientId;
    if(!clientId) throw new Error('No board UUID and no existing clientId — cannot provision');

    // Must pass the PEM *contents*: settings_storeProvisioningParameters()
    // writes an empty file for any of certificate/privateKey/rootCertificate
    // it does not receive as a string, so handing it the stored *File paths
    // would wipe the certificates it is meant to save.
    settings_storeProvisioningParameters({
        hostName,
        clientId,
        certificate:     certs.certificate,
        privateKey:      certs.privateKey,
        rootCertificate: certs.rootCertificate,
    });

    // Drop the current identity so _connectToDeviceHub() takes the
    // provisioning branch rather than reconnecting with the old certificate.
    settings_deleteConnectionParameters();
    if(cloud){
        try{ await cloud.disconnect(); } catch(_e){}
        cloud = null as any;
    }
    stateManager.updateConnectionState('connection', 'disconnected');

    await connectToDeviceHub();
}

/*
 *  Forget the provisioned identity. The device re-provisions against the
 *  configured hub on the next connect attempt.
 */
export async function resetDeviceHubConnection():Promise<void>{
    settings_deleteConnectionParameters();
    if(cloud){
        try{ await cloud.disconnect(); } catch(_e){}
        cloud = null as any;
    }
    stateManager.updateConnectionState('connection', 'disconnected');
    stateManager.updateConnectionState('provision', 'not provisioned');
}

async function _connectToDeviceHub():Promise<void>{
    // If we have connection settings, create client and connect
    if(settings.connection){
        try{
            if(!cloud){
                // Create EdgeberryDeviceHubClient with connection settings
                cloud = new EdgeberryDeviceHubClient({
                    deviceId: settings.connection.deviceId,
                    host: settings.connection.hostName,
                    cert: readFileSync( settings.connection.certificateFile ).toString(),
                    key: readFileSync( settings.connection.privateKeyFile ).toString(),
                    ca: readFileSync( settings.connection.rootCertificateFile ).toString(),
                    // MUST stay non-zero. mqtt.js treats reconnectPeriod 0 as
                    // "never reconnect", and the client library's own retry is
                    // stubbed out below — so 0 left the device permanently
                    // offline after any drop, including a Device Hub restart.
                    // mqtt.js retries on its existing client instance, which is
                    // what makes this safe: no second mqtt.connect(), so no two
                    // clients sharing a clientId.
                    // (Passing 0 also silently defeated the library's own
                    //  `reconnectPeriod || 2000` default, because its options
                    //  object spreads the caller's values in last.)
                    reconnectPeriod: 5000
                });

                // Disable the library's scheduleReconnect: it calls connect() on
                // every 'close' event, which creates a brand-new mqtt.connect()
                // without ending the previous client. Two clients with the same
                // clientId cause the broker to kick one off repeatedly → infinite
                // connect/disconnect cycle. Reconnection is mqtt.js's job here,
                // configured by reconnectPeriod above.
                (cloud as any).scheduleReconnect = () => {};
                
                // Set up event handlers
                setupCloudEventHandlers();
                
                // Initialize Direct Method API after client is created
                initializeDirectMethodAPI();

                // disable the provisioning
                stateManager.updateConnectionState( 'provision', 'disabled' );
                // Connect the client
                await cloud.connect();
            } else {
                // Cloud client already exists — force the underlying MQTT
                // client to reconnect (e.g. after AP mode disrupted WiFi).
                // Don't call cloud.connect() as it creates a new mqtt client
                // without ending the old one, causing duplicate connections.
                (cloud as any).client?.reconnect();
            }
        } catch(err){
            console.error('Cloud connect failed:', err);
            // Discard the broken client so the next connectToDeviceHub()
            // call (e.g. triggered by StateChanged reaching Full) starts fresh.
            cloud = null as any;
        }
    }
    // If there were no connection settings, but we have provisioning
    // settings, provision the device.
    else if(settings.provisioning){
        try{
            console.log('\x1b[33mStarting device provisioning...\x1b[37m');
            stateManager.updateConnectionState('provision', 'provisioning');
            
            // Start provisioning with direct MQTT client
            await startProvisioningWithMqtt();
        } catch(err){
            console.error('Provisioning failed:', err);
            stateManager.updateConnectionState('provision', 'not provisioned');
        }
    }
}

/*
 *  Surface mqtt.js's own reconnection activity.
 *  The client library reports only 'connected' and 'disconnected', so a device
 *  that had stopped retrying looked identical in the log to one that was
 *  retrying and failing — a silent gap between the two. Attaching to the
 *  underlying client makes the difference visible.
 *  The client only exists once connect() has run, so this is attached on first
 *  connect and guarded against being attached twice.
 */
let mqttLoggingAttached = false;
function attachMqttLogging(){
    if(mqttLoggingAttached) return;
    const client = (cloud as any)?.client;
    if(!client) return;
    mqttLoggingAttached = true;
    client.on('reconnect', ()=>{ console.log('\x1b[90mCloud Connection: reconnecting...\x1b[37m'); });
    client.on('offline',   ()=>{ console.log('\x1b[33mCloud Connection: offline\x1b[37m'); });
}

function setupCloudEventHandlers() {
    if (!cloud) return;
    // A fresh client means a fresh underlying mqtt client to attach to.
    mqttLoggingAttached = false;

    cloud.on('connected', ()=>{
        attachMqttLogging();
        stateManager.interruptIndicators('beep');
        stateManager.updateConnectionState('connection', 'connected');
        console.log('\x1b[32mCloud Connection: connected with device \x1b[37m');
    });

    cloud.on('disconnected', ()=>{
        stateManager.updateConnectionState('connection', 'disconnected');
        console.log('\x1b[33mCloud Connection: disconnected \x1b[37m');
    });

    cloud.on('error', (error: any)=>{
        console.error('\x1b[31mCloud Connection: '+error+'\x1b[37m');
    });

    cloud.on('cloudMessage', (message: any)=>{
        console.log('\x1b[36mReceived cloud-to-device message:\x1b[37m', message);
        // Emit D-Bus signal for applications to receive
        emitCloudMessage(message);
    });
}

async function startProvisioningWithMqtt(): Promise<void> {
    if (!settings.provisioning) return;
    
    const deviceId = settings.provisioning.clientId;
    const provReqTopic = `$devicehub/devices/${deviceId}/provision/request`;
    const provAccTopic = `$devicehub/devices/${deviceId}/provision/accepted`;
    const provRejTopic = `$devicehub/devices/${deviceId}/provision/rejected`;
    
    console.log('\x1b[33mConnecting to MQTT for provisioning...\x1b[37m');
    
    const mqttOptions: IClientOptions = {
        host: settings.provisioning.hostName,
        port: 8883,
        protocol: 'mqtts',
        clientId: deviceId,
        cert: readFileSync(settings.provisioning.certificateFile),
        key: readFileSync(settings.provisioning.privateKeyFile),
        ca: settings.provisioning.rootCertificateFile ? readFileSync(settings.provisioning.rootCertificateFile) : undefined,
        rejectUnauthorized: true,
        reconnectPeriod: 0,
        clean: true
    };
    
    provisioningClient = connect(mqttOptions);
    
    provisioningClient.on('connect', () => {
        console.log('\x1b[32mProvisioning MQTT connected\x1b[37m');
        
        // Subscribe to provisioning response topics
        provisioningClient?.subscribe([provAccTopic, provRejTopic], { qos: 1 }, (err) => {
            if (err) {
                console.error('\x1b[31mFailed to subscribe to provisioning topics:', err, '\x1b[37m');
                return;
            }
            
            console.log('\x1b[32mSubscribed to provisioning topics\x1b[37m');
            
            // Generate CSR and send provisioning request
            try {
                const { keyPem, csrPem } = genKeyAndCsr(deviceId);
                
                // Save the generated private key for later use
                const keyPath = './certificates/device_key.pem';
                writeFileSync(keyPath, keyPem);
                console.log('\x1b[32mGenerated device key and CSR\x1b[37m');
                
                // Create provisioning request payload
                const provisionPayload = {
                    csrPem,
                    name: `Edgeberry Device ${deviceId}`,
                    meta: {
                        model: system_board_getProductName(),
                        // Report the running version, not a literal that has to
                        // be remembered on every release.
                        firmware: stateManager.getState().system.version,
                        startedAt: new Date().toISOString(),
                        platform: 'edgeberry'
                    }
                };
                
                console.log('\x1b[33mSending provisioning request...\x1b[37m');
                provisioningClient?.publish(provReqTopic, JSON.stringify(provisionPayload), { qos: 1 });
                
                // Store the key path for later use
                (global as any).deviceKeyPath = keyPath;
                
            } catch (error) {
                console.error('\x1b[31mFailed to generate CSR:', error, '\x1b[37m');
                stateManager.updateConnectionState('provision', 'not provisioned');
            }
        });
    });
    
    provisioningClient.on('message', (topic, message) => {
        if (topic === provAccTopic) {
            handleProvisioningAccepted(message);
        } else if (topic === provRejTopic) {
            console.error('\x1b[31mProvisioning rejected:', message.toString(), '\x1b[37m');
            stateManager.updateConnectionState('provision', 'not provisioned');
        }
    });
    
    provisioningClient.on('error', (error) => {
        console.error('\x1b[31mProvisioning MQTT error:', error, '\x1b[37m');
        stateManager.updateConnectionState('provision', 'not provisioned');
    });
    
    provisioningClient.on('close', () => {
        console.log('\x1b[33mProvisioning MQTT connection closed\x1b[37m');
    });
}

async function handleProvisioningAccepted(message: Buffer) {
    try {
        const response = JSON.parse(message.toString());
        console.log('\x1b[32mProvisioning accepted! Received certificates\x1b[37m');
        
        if (!response.certPem) {
            console.error('\x1b[31mMissing certificate in provisioning response\x1b[37m');
            return;
        }
        
        // Save the connection parameters
        const connectionParams = {
            deviceId: response.deviceId || settings.provisioning.clientId,
            hostName: settings.provisioning.hostName,
            authenticationType: 'X.509',
            certificate: response.certPem,
            privateKey: readFileSync((global as any).deviceKeyPath || './certificates/device_key.pem', 'utf8'),
            rootCertificate: response.caChainPem || (settings.provisioning.rootCertificateFile ? readFileSync(settings.provisioning.rootCertificateFile, 'utf8') : undefined)
        };
        
        // Store connection parameters
        settings_storeConnectionParameters(connectionParams);
        console.log('\x1b[32mDevice provisioned successfully! Connecting to Device Hub...\x1b[37m');
        
        // Update state
        stateManager.updateConnectionState('provision', 'provisioned');
        
        // Disconnect provisioning client first
        if (provisioningClient) {
            provisioningClient.end(false, {}, async () => {
                try {
                    // Create EdgeberryDeviceHubClient with new connection settings
                    cloud = new EdgeberryDeviceHubClient({
                        deviceId: settings.connection.deviceId,
                        host: settings.connection.hostName,
                        cert: readFileSync(settings.connection.certificateFile).toString(),
                        key: readFileSync(settings.connection.privateKeyFile).toString(),
                        ca: readFileSync(settings.connection.rootCertificateFile).toString(),
                        // Non-zero for the same reason as in connectToDeviceHub:
                        // 0 disables mqtt.js reconnection entirely.
                        reconnectPeriod: 5000
                    });

                    // Disable library's scheduleReconnect (see connectToDeviceHub)
                    (cloud as any).scheduleReconnect = () => {};
                    
                    // Set up event handlers
                    setupCloudEventHandlers();
                    
                    // Initialize Direct Method API
                    initializeDirectMethodAPI();
                    
                    // Disable provisioning state
                    stateManager.updateConnectionState('provision', 'disabled');
                    
                    // Connect the client
                    await cloud.connect();
                    console.log('\x1b[32mSuccessfully connected to Device Hub after provisioning!\x1b[37m');
                } catch (err) {
                    console.error('\x1b[31mFailed to connect to Device Hub after provisioning:', err, '\x1b[37m');
                }
            });
        }
        
    } catch (error) {
        console.error('\x1b[31mFailed to process provisioning response:', error, '\x1b[37m');
        stateManager.updateConnectionState('provision', 'not provisioned');
    }
}

initialize();

// TODO:
// We did it this way to reduce constant data exchange with the 'device shadow',
// but we should report each state update independantly.
stateManager.on('state', (state)=>{
    // Broadcast state updates over D-Bus so applications (e.g. Node-RED
    // flows via @edgeberry/device-sdk) can react to changes.
    emitStateUpdate(state);
    // Update the system state (only when cloud is connected to
    // prevent triggering reconnection attempts on a stale client)
    if (cloud && stateManager.getState().connection.connection === 'connected') {
        cloud.updateState('system', state )
            .then(()=>{})
            .catch(()=>{});
    }
});

/*
 *  Direct Method API initialization moved to after client creation
 *  The 'Direct Method API' is for direct communication with the Dashboard. It enables
 *  the dashboard to make function calls and receive responses from the device.
 */

/*
 *  Hardware Button D-Bus Bridge
 *  Forward every button event over the ButtonEvent D-Bus signal so
 *  applications (Node-RED flows, custom SDK consumers, ...) can react
 *  to physical button interaction. Internal behavior (AP toggle,
 *  buzzer, restart, ...) remains handled locally elsewhere.
 */
(['click', 'pressrelease', 'apToggle', 'longpress', 'verylongpress'] as const).forEach((event)=>{
    system_button.on(event, ()=>{ emitButtonEvent(event); });
});

/*
 *  Button AP Mode Toggle
 *  A ~3 second press toggles AP mode on/off for WiFi provisioning.
 *
 *  DO NOT REMOVE: this is the only recovery path for a device carrying a
 *  saved network it can no longer reach (e.g. moved to a new location).
 *  There is deliberately no automatic fallback into AP mode, and the webUI
 *  toggle is unreachable in exactly that situation — the device is on no
 *  network to serve it. The physical button is load-bearing.
 */
system_button.on('apToggle', async()=>{
    const currentState = stateManager.getState();
    if(currentState.connection.wifi === 'ap_mode'){
        // Currently in AP mode - try to exit
        await exitApMode();
    }
    else{
        // Not in AP mode - enter AP mode
        try{
            await networkManager.disconnect();
        } catch(err){}
        await enterApMode();
    }
});

// When we got here, the system has started
stateManager.updateSystemState('state', 'running');
