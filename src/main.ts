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

import { readFileSync } from "fs";
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
        console.log('\x1b[33mProvisioning not yet implemented with new client\x1b[37m');
        // TODO: Implement provisioning with EdgeberryDeviceHubClient
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
