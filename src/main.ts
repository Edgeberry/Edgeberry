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
import { tmpdir } from "os";
import { spawnSync } from "child_process";
import path from "path";
import { connect, MqttClient, IClientOptions } from "mqtt";
import { StateManager } from "./state.manager";
// Dashboard cloud client
import { EdgeberryDeviceHubClient } from "@edgeberry/devicehub-device-client";
// System features
import { system_board_getProductName, system_board_getProductVersion, system_board_getUUID, system_getApplicationInfo, system_getPlatform } from "./system.service";
// Direct Methods
import { initializeDirectMethodAPI } from "./direct.methods";
// Persistent settings
import { settings, settings_deleteConnectionParameters, settings_storeConnectionParameters, settings_storeProvisioningParameters } from './settings.store';
// Commandline Interface (for inter-process communication)
import './dbus.interface';

/* State Manager */
export const stateManager = new StateManager();
stateManager.updateSystemState('state', 'starting');

/* Device Hub */
export let cloud: EdgeberryDeviceHubClient;
let provisioningClient: MqttClient | null = null;

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

    // If we have connection settings, create client and connect
    if(settings.connection){
        try{
            // Create EdgeberryDeviceHubClient with connection settings
            cloud = new EdgeberryDeviceHubClient({
                deviceId: settings.connection.deviceId,
                host: settings.connection.hostName,
                cert: readFileSync( settings.connection.certificateFile ).toString(),
                key: readFileSync( settings.connection.privateKeyFile ).toString(),
                ca: readFileSync( settings.connection.rootCertificateFile ).toString(),
                reconnectPeriod: 0 // Disable built-in reconnection - use custom logic
            });
            
            // Set up event handlers
            setupCloudEventHandlers();
            
            // Initialize Direct Method API after client is created
            initializeDirectMethodAPI();
            
            // disable the provisioning
            stateManager.updateConnectionState( 'provision', 'disabled' );
            // Connect the client
            await cloud.connect();
        } catch(err){
            console.error('Cloud connect failed:', err);
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

function setupCloudEventHandlers() {
    if (!cloud) return;
    
    cloud.on('connected', ()=>{
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
                        firmware: '3.0.0',
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

function handleProvisioningAccepted(message: Buffer) {
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
        console.log('\x1b[32mDevice provisioned successfully! Restarting...\x1b[37m');
        
        // Update state
        stateManager.updateConnectionState('provision', 'provisioned');
        
        // Disconnect provisioning client and restart
        if (provisioningClient) {
            provisioningClient.end(false, {}, () => {
                process.exit(0); // Restart the service
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
    // Update the system state
    if (cloud) {
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

// When we got here, the system has started
stateManager.updateSystemState('state', 'running');
