/*
 *  Edge Gateway
 */

import { readFileSync } from "fs";
import { AzureClient } from "./azure";
import express from 'express';
import { system_beepBuzzer, system_getWirelessAddress, system_getWirelessSSID, system_setStatusLed } from "./system";

const cors = require('cors');

/* Use Settings from file */
try{
    console.log('\x1b[90mReading settings from settings file...\x1b[37m');
    var settings = JSON.parse(readFileSync('settings.json').toString());
    console.log('\x1b[32mSettings read from settings file \x1b[37m');
} catch(err){
    console.error('\x1b[31mCould not read settings file! \x1b[37m');
    // ToDo: create settings file?
}

/* Express Web/API server */
const app = express();
const port = settings?.interface?.port?settings.interface.port:3000     // default webui port: 3000

app.use(express.json());        // JSON API
app.use(cors({origin:'*'}));    // Cross-origin references


// API routes
import connectivityRoutes from './routes/connectivity';
import systemRoutes from './routes/system';
app.use('/api/connectivity', connectivityRoutes );
app.use('/api/system', systemRoutes );

// Serve the public directory and a static HTML index file
app.use(express.static( __dirname+'/public/'));
app.get('*', (req:any, res:any)=>{
    return res.sendFile('index.html',{ root: __dirname+'/public' });
});


// Start the webserver
app.listen( port, ()=>{ console.log('\x1b[32mEdge Gateway UI server running on port '+port+'\x1b[30m')});

// Blink the status LED orange
system_setStatusLed( 'orange', true );

/* Azure IoT Hub Connection */
export const cloud = new AzureClient();

async function initialize(){
    try{
        await cloud.updateProvisioningParameters({ registrationId: settings.provisioning.registrationId,
                                                   idScope: settings.provisioning.idScope,
                                                   hostName: settings.provisioning.hostName,
                                                   authenticationType: settings.provisioning.authenticationType,
                                                   registrationKey: settings.provisioning.registrationKey
                                                });
        // provision the client
        await cloud.provision();
        // connect the client
        await cloud.connect();
    } catch(err){
        console.error(err);
    }
}

//initialize();

/* Cloud Event handlers */
cloud.on('connected', ()=>{
    system_setStatusLed( 'green', true );
    let connectionParameters = cloud.getConnectionParameters();
    console.log('\x1b[32mConnected to Azure IoT Hub: '+connectionParameters?.deviceId+' @ '+connectionParameters?.hostName+' ('+connectionParameters?.authenticationType+') \x1b[37m');
});

cloud.on('disconnected', ()=>{
    system_setStatusLed( 'green', true, 'orange' );
});

cloud.on('provisioning', ()=>{
    system_beepBuzzer('long');
    system_setStatusLed( 'orange', 70 );
    console.log('\x1b[90mProvisioning the Azure IoT Client... \x1b[37m');
});

cloud.on('provisioned', ()=>{
    console.log('\x1b[32mProvisioning from Device Provisioning Service for Azure IoT Hub succeeded!\x1b[37m');
});

cloud.on('connecting', ()=>{
    system_setStatusLed( 'green', 70, 'orange' );
    system_beepBuzzer('short');
    console.log('\x1b[90mConnecting to Azure IoT Hub... \x1b[37m');
});

cloud.on('error', (error)=>{
    console.error('\x1b[31mAzure: '+error+'\x1b[37m');
});

cloud.on('warning', (warning)=>{
    console.error('\x1b[33mAzure: '+warning+'\x1b[37m');
});


cloud.on('status', (status)=>{
    // inform the application about the status
    ipc.send( status );
});


/*
 *  SDK
 *  Through inter-process communication
 */

import { IPC_Client } from "@spuq/json-ipc";
const ipc = new IPC_Client( true , "Gateway-SDK","./sdk-ipc");

// receiving data from the other process
ipc.on('data', (data:object)=>{
    console.log(data);
});


// Connection status
ipc.on('connected', ()=>{
    console.log('\x1b[32mApplication connected\x1b[37m');
});

ipc.on('disconnected', ()=>{
    console.error('\x1b[33mApplication disconnected\x1b[37m');
});