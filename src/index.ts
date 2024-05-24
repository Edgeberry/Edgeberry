/*
 *  EdgeBerry
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
import express from 'express';
import { StateManager } from "./stateManager";
import cors from 'cors';
// Dashboard cloud client
import { AWSClient } from "./aws";
// System features
import { system_board_getProductName, system_board_getProductVersion, system_board_getUUID, system_getApplicationInfo, system_getPlatform } from "./system";
// API routes
import connectivityRoutes from './routes/connectivity';
import systemRoutes from './routes/system';
import applicationRoutes from './routes/application';
// Direct Methods
import { initializeDirectMethodAPI } from "./directMethodAPI";
// Persistent settings
import { settings, settings_deleteConnectionParameters, settings_storeConnectionParameters, settings_storeProvisioningParameters } from './persistence';
// Commandline Interface (for inter-process communication)
import './cli';

/* State Manager */
export const stateManager = new StateManager();
stateManager.updateSystemState('state', 'starting');

/* Express Web/API server */
const app = express();
const port = settings?.interface?.port?settings.interface.port:3000     // default webui port: 3000
// Express tools
app.use(express.json());        // JSON API
app.use(cors({origin:'*'}));    // Cross-origin references
// Use the API Routers
app.use('/api/connectivity', connectivityRoutes );
app.use('/api/system', systemRoutes );
app.use('/api/application', applicationRoutes );
// Serve the public directory and a static HTML index file
app.use(express.static( __dirname+'/public/'));
app.get('*', (req:any, res:any)=>{
    return res.sendFile('index.html',{ root: __dirname+'/public' });
});
// Start the webserver
app.listen( port, ()=>{ console.log('\x1b[32mEdgeberry UI server running on port '+port+'\x1b[30m')});

/* AWS IoT Core */
export const cloud = new AWSClient();

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

    // load the settings
    try{
        if(settings.provisioning)
        await cloud.updateProvisioningParameters({
            hostName: settings.provisioning.hostName,
            clientId: settings.provisioning.clientId,
            authenticationType: 'x509',
            certificate: readFileSync( settings.provisioning.certificateFile ).toString(),
            privateKey: readFileSync( settings.provisioning.privateKeyFile ).toString(),
            rootCertificate: readFileSync( settings.provisioning.rootCertificateFile ).toString()
        });
        // Update the connection parameters from the settings
        if(settings.connection)
        await cloud.updateConnectionParameters({
            hostName: settings.connection.hostName,
            deviceId: settings.connection.deviceId,
            authenticationType: 'x509',
            certificate: readFileSync( settings.connection.certificateFile ).toString(),
            privateKey: readFileSync( settings.connection.privateKeyFile ).toString(),
            rootCertificate: readFileSync( settings.connection.rootCertificateFile ).toString()
        });
    } catch (err){}

    // If we have connection settings, connect to the cloud using
    // these settings
    if(settings.connection){
        // Initialize Cloud connection
        try{
            // disable the provisioning
            stateManager.updateConnectionState( 'provision', 'disabled' );
            // Connect the client
            await cloud.connect();
        } catch(err){
            //console.error(err);
        }
    }
    // If there were no connection settings, but we have provisioning
    // settings, provision the device.
    else if(settings.provisioning){
        // Provision the device
        try{
            await cloud.provision();
        }
        catch(err){
            console.error("Device provisioning failed: "+err);
        }
    }
}

initialize();

/* Cloud Event handlers */
cloud.on('connected', ()=>{
    stateManager.interruptIndicators('beep');
    stateManager.updateConnectionState('connection', 'connected');
    let connectionParameters = cloud.getConnectionParameters();
    console.log('\x1b[32mCloud Connection: connected with '+connectionParameters?.deviceId+' @ '+connectionParameters?.hostName+' ('+connectionParameters?.authenticationType+') \x1b[37m');
});

cloud.on('disconnected', ()=>{
    stateManager.updateConnectionState('connection', 'disconnected');
    console.log('\x1b[33mCloud Connection: disconnected \x1b[37m');
});

cloud.on('provisioning', ()=>{
    stateManager.updateConnectionState('provision', 'provisioning');
    console.log('\x1b[90mProvisioning the Cloud client... \x1b[37m');
});

cloud.on('provisioned', async( connectionParameters )=>{
    stateManager.updateConnectionState('provision', 'provisioned');
    console.log('\x1b[32mProvisioning succeeded!\x1b[37m');

    // Save the connection parameters
    settings_storeConnectionParameters( connectionParameters );

    // Connect to the cloud with the parameters provided
    // by the provisioning service.
    await cloud.updateConnectionParameters({
        hostName: connectionParameters.hostName,
        deviceId: connectionParameters.deviceId,
        authenticationType: 'x509',
        certificate: connectionParameters.certificate,
        privateKey: connectionParameters.privateKey,
        rootCertificate: connectionParameters.rootCa
    });
    // Connect the cloud client
    await cloud.connect();
    // TODO: save the connection parameters!
});

cloud.on('connecting', ()=>{
    stateManager.updateConnectionState('connection', 'connecting');
    console.log('\x1b[90mConnecting to cloud... \x1b[37m');
});

cloud.on('error', (error)=>{
    console.error('\x1b[31mCloud Connection: '+error+'\x1b[37m');
});

cloud.on('warning', (warning)=>{
    console.error('\x1b[33mCloud Connection: '+warning+'\x1b[37m');
});

cloud.on('status', (status)=>{});

// TODO:
// We did it this way to reduce constant data exchange with the 'device shadow',
// but we should report each state update independantly.
stateManager.on('state', (state)=>{
    // Update the system state
    cloud.updateState('system', state )
        .then(()=>{})
        .catch(()=>{});
});

/*
 *  Initialize Direct Method API
 *  The 'Direct Method API' is for direct communication with the Dashboard. It enables
 *  the dashboard to make function calls and receive responses from the device.
 */
initializeDirectMethodAPI();

// When we got here, the system has started
stateManager.updateSystemState('state', 'running');

