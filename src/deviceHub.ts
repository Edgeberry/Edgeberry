/*
 *  Device Hub Service
 *  Owns everything to do with the connection to the Edgeberry Device Hub:
 *  the MQTT client's lifecycle, its reconnection behaviour, and the X.509
 *  fleet-provisioning exchange that obtains the device's identity.
 *
 *  This exists so that exactly one object owns the client: it is replaced on
 *  every reconnect, and a copy of the reference held anywhere else is a copy
 *  that goes stale.
 */

import { EventEmitter } from 'events';
import { readFileSync } from 'fs';
import { EdgeberryDeviceHubClient, provisionDevice } from '@edgeberry/devicehub-device-client';

import { StateManager } from './stateManager';
import { fetchProvisioningCertificates } from './certificates';
import {
    settings,
    settings_deleteConnectionParameters,
    settings_deleteProvisioningParameters,
    settings_storeConnectionParameters,
    settings_storeProvisioningParameters,
} from './settingsStore';

/*
 *  Reconnection is the library's concern, not this file's.
 *
 *  It applies exponential backoff with full jitter (see reconnectDelay() in
 *  @edgeberry/devicehub-device-client) so that a fleet dropped by one hub
 *  restart does not come back in lockstep and re-synchronise into a retry
 *  storm. The constants below were tuned here first and now live in the
 *  library as its defaults; this service only listens to what it reports.
 */

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
    private connectInProgress = false;

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

                // Provisioning has stored connection parameters, so bring the
                // identity connection up in this same pass. It has to be
                // connectWithIdentity() and not connect(): we are already
                // inside connect()'s in-progress guard, and re-entering it
                // returns immediately, leaving the device provisioned but
                // offline until something else triggers a connect.
                if(settings.connection) await this.connectWithIdentity();
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
            this.client.reconnect();
            return;
        }

        try{
            this.client = new EdgeberryDeviceHubClient({
                deviceId: settings.connection.deviceId,
                host:     settings.connection.hostName,
                cert:     readFileSync(settings.connection.certificateFile).toString(),
                key:      readFileSync(settings.connection.privateKeyFile).toString(),
                ca:       readFileSync(settings.connection.rootCertificateFile).toString(),
            });

            this.wireClientEvents();

            // The client exists but is not connected yet. Direct methods are
            // registered against it here, before the connection is awaited,
            // because the library subscribes to their topics on connect.
            this.emit('clientReady', this.client);

            this.stateManager.updateConnectionState('provision', 'disabled');

            await this.client.connect();
        } catch(err){
            console.error('Cloud connect failed:', err);
            this.discardClientUnlessRetrying();
        }
    }

    /**
     * Keep a client that is still retrying; drop one that is inert.
     *
     * Dropping a retrying client would leave it reconnecting in the background
     * while the next connect() built a second client on the same clientId, and
     * the broker would then kick the two alternately, forever. A client whose
     * certificates failed to load never got that far and is safe to discard.
     */
    private discardClientUnlessRetrying():void{
        if(this.client?.isRetrying()){
            console.log('\x1b[90mCloud Connection: retrying in the background\x1b[37m');
            return;
        }
        if(this.client){
            this.client.disconnect().catch(()=>{});
            this.client = null;
        }
    }

    private wireClientEvents():void{
        if(!this.client) return;

        this.client.on('connected', ()=>{
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

        // Without these, a device that had stopped retrying looked identical in
        // the log to one retrying and failing: silence either way. That
        // ambiguity hid a fleet-wide outage bug once already.
        this.client.on('reconnecting', ({ attempt, delayMs }:{attempt:number, delayMs:number})=>{
            console.log('\x1b[90mCloud Connection: reconnecting (attempt '+attempt+
                        ', next in ~'+Math.round(delayMs/1000)+'s)\x1b[37m');
        });

        this.client.on('offline', ()=>{
            console.log('\x1b[33mCloud Connection: offline\x1b[37m');
        });
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
        }
        this.stateManager.updateConnectionState('connection', 'disconnected');
        this.stateManager.updateConnectionState('provision', 'not provisioned');
    }

    /*
     *  X.509 fleet provisioning
     *
     *  The exchange itself - the two round trips, the CSR, the topics - belongs
     *  to the client library. This method's job is only the parts that are this
     *  device's business: what metadata to announce, and what to do with the
     *  identity once it has one.
     */

    private async runProvisioningExchange():Promise<void>{
        if(!settings.provisioning) return;

        console.log('\x1b[33mProvisioning against '+settings.provisioning.hostName+'...\x1b[37m');

        const issued = await provisionDevice({
            host: settings.provisioning.hostName,
            uuid: settings.provisioning.clientId,
            cert: readFileSync(settings.provisioning.certificateFile),
            key:  readFileSync(settings.provisioning.privateKeyFile),
            ca:   settings.provisioning.rootCertificateFile
                      ? readFileSync(settings.provisioning.rootCertificateFile)
                      : undefined,
            meta: {
                model:     this.stateManager.getState().system.board,
                firmware:  this.stateManager.getState().system.version,
                startedAt: new Date().toISOString(),
                platform:  'edgeberry',
            },
        });

        console.log('\x1b[32mProvisioning accepted! Assigned deviceId: '+issued.deviceId+'\x1b[37m');

        settings_storeConnectionParameters({
            deviceId:           issued.deviceId,
            hostName:           settings.provisioning.hostName,
            authenticationType: 'X.509',
            certificate:        issued.certPem,
            privateKey:         issued.privateKeyPem,
            rootCertificate:    issued.caChainPem
                                    || (settings.provisioning.rootCertificateFile
                                        ? readFileSync(settings.provisioning.rootCertificateFile, 'utf8')
                                        : undefined),
        });

        // The device's own identity is now on disk - the fleet-shared
        // provisioning certificate and its key have served their one purpose
        // and are only exposure risk from here on.
        settings_deleteProvisioningParameters();

        console.log('\x1b[32mDevice provisioned successfully! Connecting to Device Hub...\x1b[37m');
        this.stateManager.updateConnectionState('provision', 'provisioned');

        await this.connect();
    }
}
