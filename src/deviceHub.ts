/*
 *  Device Hub Service
 *  Owns everything to do with the connection to the Edgeberry Device Hub:
 *  the MQTT client's lifecycle, its reconnection behaviour, and the X.509
 *  fleet-provisioning exchange that obtains the device's identity.
 *
 *  This exists so that exactly one object owns the client. It previously lived
 *  in main.ts as an `export let cloud`, reassigned on every reconnect and read
 *  back through `require('./main')` from four other modules — which is why the
 *  import graph had a cycle in it.
 */

import { EventEmitter } from 'events';
import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import path from 'path';
import { connect, MqttClient, IClientOptions } from 'mqtt';
import { EdgeberryDeviceHubClient } from '@edgeberry/devicehub-device-client';

import { StateManager } from './stateManager';
import { fetchProvisioningCertificates } from './certificates';
import {
    settings,
    settings_deleteConnectionParameters,
    settings_storeConnectionParameters,
    settings_storeProvisioningParameters,
} from './settingsStore';

/*
 *  Reconnection policy — exponential backoff with full jitter.
 *
 *  mqtt.js retries on a fixed interval. That is fine for one device and bad for
 *  a fleet: every device dropped by the same hub restart comes back in lockstep
 *  and hits the hub with a synchronised burst of mTLS handshakes, which can push
 *  it over again and re-synchronise everyone into a retry storm.
 *
 *  Each retry therefore waits a random delay from a window that doubles per
 *  consecutive failure. Randomising from the very first retry spreads the fleet
 *  immediately; doubling decays the offered load over a long outage; the cap
 *  keeps recovery timely.
 *
 *  No custom retry loop is needed: mqtt.js re-reads options.reconnectPeriod
 *  every time it reschedules (_cleanUp calls _clearReconnect then
 *  _setupReconnect), so varying that value between attempts is enough. Retries
 *  then happen on the *existing* client instance, which is what keeps a second
 *  client off the same clientId.
 */
const RECONNECT_MIN_MS  = 1000;     // floor; also keeps the value above zero
const RECONNECT_BASE_MS = 5000;     // first window: 1–5 s
const RECONNECT_MAX_MS  = 60000;    // window ceiling

export function reconnectDelay( attempt:number ):number{
    const ceiling = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * Math.pow(2, attempt));
    // Never zero: mqtt.js reads reconnectPeriod 0 as "stop reconnecting", which
    // is exactly how devices used to stay offline after a hub restart.
    return Math.round(RECONNECT_MIN_MS + Math.random() * Math.max(0, ceiling - RECONNECT_MIN_MS));
}

export type DeviceHubStatus = {
    hostName:        string | null;
    deviceId:        string | null;
    configured:      boolean;   // a hub is known (provisioning and/or connection settings)
    provisioned:     boolean;   // a device certificate has been issued
    certificateFile: string | null;
};

/**
 * Emits:
 *   'cloudMessage' (payload)  — cloud-to-device message, for the D-Bus bridge
 */
export class DeviceHubService extends EventEmitter {
    private client: EdgeberryDeviceHubClient | null = null;
    private provisioningClient: MqttClient | null = null;
    private connectInProgress = false;
    private policyAttached = false;

    constructor( private readonly stateManager:StateManager ){
        super();
    }

    /*
     *  Accessors
     */

    /** The underlying hub client, or null when none has been created yet. */
    public getClient():EdgeberryDeviceHubClient | null{
        return this.client;
    }

    public isConnected():boolean{
        return this.stateManager.getState().connection.connection === 'connected';
    }

    public getStatus():DeviceHubStatus{
        return {
            hostName:        settings?.connection?.hostName ?? settings?.provisioning?.hostName ?? null,
            deviceId:        settings?.connection?.deviceId ?? settings?.provisioning?.clientId ?? null,
            configured:      Boolean(settings?.provisioning || settings?.connection),
            provisioned:     Boolean(settings?.connection),
            certificateFile: settings?.connection?.certificateFile ?? null,
        };
    }

    /** Raw client status from the library, or null when no client exists. */
    public getClientStatus():any{
        try{ return this.client ? this.client.getClientStatus() : null; }
        catch(_err){ return null; }
    }

    /*
     *  Connection lifecycle
     */

    /**
     * Bring the hub connection up. Safe to call repeatedly and from several
     * triggers at once (boot, NetworkManager connectivity changes, the web UI);
     * concurrent calls collapse into the first one.
     */
    public async connect():Promise<void>{
        if(this.connectInProgress) return;
        this.connectInProgress = true;
        try{ await this.connectOnce(); }
        finally{ this.connectInProgress = false; }
    }

    private async connectOnce():Promise<void>{
        // A provisioned device connects; an unprovisioned one first has to earn
        // a certificate. Connection settings therefore take precedence.
        if(settings.connection){
            await this.connectWithIdentity();
        }
        else if(settings.provisioning){
            try{
                console.log('\x1b[33mStarting device provisioning...\x1b[37m');
                this.stateManager.updateConnectionState('provision', 'provisioning');
                await this.runProvisioningExchange();
            } catch(err){
                console.error('Provisioning failed:', err);
                this.stateManager.updateConnectionState('provision', 'not provisioned');
            }
        }
    }

    private async connectWithIdentity():Promise<void>{
        // An existing client is already managing its own reconnection — nudge it
        // rather than building a second one on the same clientId.
        if(this.client){
            (this.client as any).client?.reconnect();
            return;
        }

        try{
            this.client = new EdgeberryDeviceHubClient({
                deviceId: settings.connection.deviceId,
                host:     settings.connection.hostName,
                cert:     readFileSync(settings.connection.certificateFile).toString(),
                key:      readFileSync(settings.connection.privateKeyFile).toString(),
                ca:       readFileSync(settings.connection.rootCertificateFile).toString(),
                // Must stay above zero — see reconnectDelay(). The policy
                // attached below takes over the value from the first retry on.
                reconnectPeriod: RECONNECT_BASE_MS,
            });

            // The library's own scheduleReconnect() calls connect(), which builds
            // a brand-new mqtt client without ending the previous one. Two clients
            // sharing a clientId make the broker kick them alternately, forever.
            // Reconnection is mqtt.js's job here, governed by reconnectPeriod.
            (this.client as any).scheduleReconnect = () => {};

            this.policyAttached = false;
            this.wireClientEvents();

            // The client exists but is not connected yet. Direct methods are
            // registered against it here, before the connection is awaited,
            // because the library subscribes to their topics on connect.
            this.emit('clientReady', this.client);

            this.stateManager.updateConnectionState('provision', 'disabled');

            // The underlying mqtt client is created synchronously inside
            // connect(), so the policy can be attached before awaiting. The first
            // attempt can fail too (hub down while the device boots) and that
            // retry needs jittering just as much as any later one.
            const connecting = this.client.connect();
            this.attachReconnectPolicy();
            await connecting;
        } catch(err){
            console.error('Cloud connect failed:', err);
            this.discardClientUnlessRetrying();
        }
    }

    /**
     * Keep a client that mqtt.js is still retrying; drop one that is inert.
     *
     * Dropping a retrying client would leave it reconnecting in the background
     * while the next connect() built a second client on the same clientId — the
     * duplicate-connection fault described above. A client whose certificates
     * failed to load never got an mqtt client at all and is safe to discard.
     */
    private discardClientUnlessRetrying():void{
        const mqttClient = (this.client as any)?.client;
        if(mqttClient && !mqttClient.disconnecting){
            console.log('\x1b[90mCloud Connection: retrying in the background\x1b[37m');
            return;
        }
        try{ mqttClient?.end(true); } catch(_err){}
        this.client = null;
        this.policyAttached = false;
    }

    private wireClientEvents():void{
        if(!this.client) return;

        this.client.on('connected', ()=>{
            this.attachReconnectPolicy();
            this.stateManager.interruptIndicators('beep');
            this.stateManager.updateConnectionState('connection', 'connected');
            console.log('\x1b[32mCloud Connection: connected with device \x1b[37m');
        });

        this.client.on('disconnected', ()=>{
            this.stateManager.updateConnectionState('connection', 'disconnected');
            console.log('\x1b[33mCloud Connection: disconnected \x1b[37m');
        });

        this.client.on('error', (error:any)=>{
            console.error('\x1b[31mCloud Connection: '+error+'\x1b[37m');
        });

        this.client.on('cloudMessage', (message:any)=>{
            console.log('\x1b[36mReceived cloud-to-device message:\x1b[37m', message);
            this.emit('cloudMessage', message);
        });
    }

    /**
     * Apply the backoff policy to the underlying mqtt client, and log its
     * reconnection activity.
     *
     * The library reports only 'connected'/'disconnected', so a device that had
     * stopped retrying looked identical in the log to one retrying and failing:
     * silence either way. That ambiguity hid a fleet-wide outage bug.
     */
    private attachReconnectPolicy():void{
        if(this.policyAttached) return;
        const mqttClient = (this.client as any)?.client;
        if(!mqttClient) return;
        this.policyAttached = true;

        let attempt = 0;

        mqttClient.on('connect', ()=>{
            attempt = 0;
            mqttClient.options.reconnectPeriod = reconnectDelay(0);
        });

        mqttClient.on('reconnect', ()=>{
            attempt++;
            mqttClient.options.reconnectPeriod = reconnectDelay(attempt);
            console.log('\x1b[90mCloud Connection: reconnecting (attempt '+attempt+
                        ', next in ~'+Math.round(mqttClient.options.reconnectPeriod/1000)+'s)\x1b[37m');
        });

        mqttClient.on('offline', ()=>{
            console.log('\x1b[33mCloud Connection: offline\x1b[37m');
        });

        // Seed the first window so even the initial retry is jittered.
        mqttClient.options.reconnectPeriod = reconnectDelay(0);
    }

    /*
     *  Outbound
     */

    /** Publish telemetry. Throws when no client exists, so callers can report why. */
    public sendTelemetry( data:any ):void{
        if(!this.client) throw new Error('Device Hub client not initialized');
        this.client.sendTelemetry(data);
    }

    /**
     * Mirror device state into the hub's shadow.
     * Only attempted while connected: writing through a stale client provokes
     * reconnection attempts that the backoff policy is deliberately pacing.
     */
    public publishState( key:string, value:any ):void{
        if(!this.client || !this.isConnected()) return;
        this.client.updateState(key, value).catch(()=>{});
    }

    /*
     *  Provisioning
     */

    /**
     * Point the device at a hub and provision against it — the web-interface
     * equivalent of `edgeberry --setup`.
     *
     * Certificates are fetched *before* anything is written, so a hub that is
     * unreachable or serving the wrong thing leaves existing settings intact.
     */
    public async provision( hostName:string, boardUUID:string|null ):Promise<void>{
        const certs = await fetchProvisioningCertificates(hostName);
        console.log('\x1b[32mFetched provisioning certificates from '+hostName+' via '+certs.via+'\x1b[37m');

        const clientId = boardUUID ?? settings?.provisioning?.clientId;
        if(!clientId) throw new Error('No board UUID and no existing clientId — cannot provision');

        // Pass the PEM *contents*. settings_storeProvisioningParameters() writes
        // an empty file for any of certificate/privateKey/rootCertificate it does
        // not receive as a string, so handing it the stored *File paths would
        // erase the very certificates it is meant to save.
        settings_storeProvisioningParameters({
            hostName,
            clientId,
            certificate:     certs.certificate,
            privateKey:      certs.privateKey,
            rootCertificate: certs.rootCertificate,
        });

        await this.forgetIdentity();
        await this.connect();
    }

    /** Discard the provisioned identity; the device re-provisions on next connect. */
    public async forgetIdentity():Promise<void>{
        settings_deleteConnectionParameters();
        if(this.client){
            try{ await this.client.disconnect(); } catch(_err){}
            this.client = null;
            this.policyAttached = false;
        }
        this.stateManager.updateConnectionState('connection', 'disconnected');
        this.stateManager.updateConnectionState('provision', 'not provisioned');
    }

    /*
     *  X.509 fleet provisioning over MQTT
     *
     *  The device authenticates with the fleet-wide provisioning certificate,
     *  submits a CSR, and receives a certificate of its own in return.
     */

    private async runProvisioningExchange():Promise<void>{
        if(!settings.provisioning) return;

        const deviceId     = settings.provisioning.clientId;
        const requestTopic  = `$devicehub/devices/${deviceId}/provision/request`;
        const acceptedTopic = `$devicehub/devices/${deviceId}/provision/accepted`;
        const rejectedTopic = `$devicehub/devices/${deviceId}/provision/rejected`;

        console.log('\x1b[33mConnecting to MQTT for provisioning...\x1b[37m');

        const options:IClientOptions = {
            host:       settings.provisioning.hostName,
            port:       8883,
            protocol:   'mqtts',
            clientId:   deviceId,
            cert:       readFileSync(settings.provisioning.certificateFile),
            key:        readFileSync(settings.provisioning.privateKeyFile),
            ca:         settings.provisioning.rootCertificateFile
                            ? readFileSync(settings.provisioning.rootCertificateFile)
                            : undefined,
            rejectUnauthorized: true,
            // One-shot exchange: a retry loop here would race the connect()
            // that follows a successful provisioning.
            reconnectPeriod: 0,
            clean: true,
        };

        this.provisioningClient = connect(options);

        this.provisioningClient.on('connect', ()=>{
            console.log('\x1b[32mProvisioning MQTT connected\x1b[37m');
            this.provisioningClient?.subscribe([acceptedTopic, rejectedTopic], { qos:1 }, (err)=>{
                if(err){
                    console.error('\x1b[31mFailed to subscribe to provisioning topics:', err, '\x1b[37m');
                    return;
                }
                this.submitCertificateRequest(deviceId, requestTopic);
            });
        });

        this.provisioningClient.on('message', (topic, message)=>{
            if(topic === acceptedTopic) this.onProvisioningAccepted(message);
            else if(topic === rejectedTopic){
                console.error('\x1b[31mProvisioning rejected:', message.toString(), '\x1b[37m');
                this.stateManager.updateConnectionState('provision', 'not provisioned');
            }
        });

        this.provisioningClient.on('error', (error)=>{
            console.error('\x1b[31mProvisioning MQTT error:', error, '\x1b[37m');
            this.stateManager.updateConnectionState('provision', 'not provisioned');
        });
    }

    private submitCertificateRequest( deviceId:string, requestTopic:string ):void{
        try{
            const { keyPem, csrPem } = generateKeyAndCsr(deviceId);

            // Keep the private key: the certificate the hub returns is useless
            // without the key that the CSR was built from.
            writeFileSync(PENDING_DEVICE_KEY_PATH, keyPem);
            console.log('\x1b[32mGenerated device key and CSR\x1b[37m');

            const payload = {
                csrPem,
                name: `Edgeberry Device ${deviceId}`,
                meta: {
                    model:     this.stateManager.getState().system.board,
                    firmware:  this.stateManager.getState().system.version,
                    startedAt: new Date().toISOString(),
                    platform:  'edgeberry',
                },
            };

            console.log('\x1b[33mSending provisioning request...\x1b[37m');
            this.provisioningClient?.publish(requestTopic, JSON.stringify(payload), { qos:1 });
        } catch(error){
            console.error('\x1b[31mFailed to generate CSR:', error, '\x1b[37m');
            this.stateManager.updateConnectionState('provision', 'not provisioned');
        }
    }

    private onProvisioningAccepted( message:Buffer ):void{
        try{
            const response = JSON.parse(message.toString());
            console.log('\x1b[32mProvisioning accepted! Received certificates\x1b[37m');

            if(!response.certPem){
                console.error('\x1b[31mMissing certificate in provisioning response\x1b[37m');
                return;
            }

            settings_storeConnectionParameters({
                deviceId:           response.deviceId || settings.provisioning.clientId,
                hostName:           settings.provisioning.hostName,
                authenticationType: 'X.509',
                certificate:        response.certPem,
                privateKey:         readFileSync(PENDING_DEVICE_KEY_PATH, 'utf8'),
                rootCertificate:    response.caChainPem
                                        || (settings.provisioning.rootCertificateFile
                                            ? readFileSync(settings.provisioning.rootCertificateFile, 'utf8')
                                            : undefined),
            });

            console.log('\x1b[32mDevice provisioned successfully! Connecting to Device Hub...\x1b[37m');
            this.stateManager.updateConnectionState('provision', 'provisioned');

            // Close the provisioning session before opening the real one: both
            // use the same clientId, and the broker will not tolerate two.
            this.provisioningClient?.end(false, {}, ()=>{
                this.provisioningClient = null;
                this.connect().catch((err)=>{
                    console.error('\x1b[31mFailed to connect after provisioning:', err, '\x1b[37m');
                });
            });
        } catch(error){
            console.error('\x1b[31mFailed to process provisioning response:', error, '\x1b[37m');
            this.stateManager.updateConnectionState('provision', 'not provisioned');
        }
    }
}

/*
 *  Certificate signing request helpers
 */

// Where the private key waits between generating the CSR and the hub accepting
// it. Relative to the working directory, like the rest of the certificate store.
const PENDING_DEVICE_KEY_PATH = './certificates/device_key.pem';

function openssl( args:string[], input?:string ):{ code:number, out:string, err:string }{
    const result = spawnSync('openssl', args, { input, encoding:'utf8' });
    return { code: result.status ?? 1, out: result.stdout || '', err: result.stderr || '' };
}

function generateKeyAndCsr( deviceId:string ):{ keyPem:string; csrPem:string }{
    const dir     = mkdtempSync(path.join(tmpdir(), 'edgeberry-device-'));
    const keyPath = path.join(dir, `${deviceId}.key`);
    const csrPath = path.join(dir, `${deviceId}.csr`);

    let result = openssl(['genrsa', '-out', keyPath, '2048']);
    if(result.code !== 0) throw new Error(`openssl genrsa failed: ${result.err || result.out}`);

    result = openssl(['req', '-new', '-key', keyPath, '-subj', `/CN=${deviceId}`, '-out', csrPath]);
    if(result.code !== 0) throw new Error(`openssl req -new failed: ${result.err || result.out}`);

    return {
        keyPem: readFileSync(keyPath, 'utf8'),
        csrPem: readFileSync(csrPath, 'utf8'),
    };
}
