/*
 *  Edge Gateway
 */

import { readFileSync } from "fs";
import { AzureClient } from "./azure";
import express from 'express';
import { StateManager } from "./stateManager";

/* State Manager */
export const stateManager = new StateManager();
stateManager.updateSystemState('state', 'starting');

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
import applicationRoutes from './routes/application';
app.use('/api/connectivity', connectivityRoutes );
app.use('/api/system', systemRoutes );
app.use('/api/application', applicationRoutes );

// Serve the public directory and a static HTML index file
app.use(express.static( __dirname+'/public/'));
app.get('*', (req:any, res:any)=>{
    return res.sendFile('index.html',{ root: __dirname+'/public' });
});


// Start the webserver
app.listen( port, ()=>{ console.log('\x1b[32mEdge Gateway UI server running on port '+port+'\x1b[30m')});

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

initialize();

/* Cloud Event handlers */
cloud.on('connected', ()=>{
    stateManager.updateConnectionState('connection', 'connected');
    let connectionParameters = cloud.getConnectionParameters();
    console.log('\x1b[32mConnected to Azure IoT Hub: '+connectionParameters?.deviceId+' @ '+connectionParameters?.hostName+' ('+connectionParameters?.authenticationType+') \x1b[37m');
});

cloud.on('disconnected', ()=>{
    stateManager.updateConnectionState('connection', 'disconnected');
});

cloud.on('provisioning', ()=>{
    stateManager.updateConnectionState('provision', 'provisioning');
    console.log('\x1b[90mProvisioning the Azure IoT Client... \x1b[37m');
});

cloud.on('provisioned', ()=>{
    stateManager.updateConnectionState('provision', 'provisioned');
    console.log('\x1b[32mProvisioning from Device Provisioning Service for Azure IoT Hub succeeded!\x1b[37m');
});

cloud.on('connecting', ()=>{
    stateManager.updateConnectionState('connection', 'connecting');
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
 *  Communication with another application through 
 *  inter-process communication.
 */

import { IPC_Client } from "@spuq/json-ipc";
import { system_getApplicationInfo } from "./system";
const ipc = new IPC_Client( true , "Gateway-SDK","./sdk-ipc");

// receiving data from the other process
ipc.on('data', async(data:any)=>{
    //console.log(data);
    // When a method is called from the IPC
    if(data?.method){
        switch(data.method){
            case 'beep':        stateManager.interruptIndicators('beep');
                                break;

            // Send Message
            case 'sendMessage': if(!data?.data || !data?.properties) return;
                                try{
                                    await cloud.sendMessage( {data:data.data, properties:data.properties} );
                                } catch(err){}
                                break;

            // Unrecognized method
            default:
                                break;
        }
    }
});


// Connection status
ipc.on('connected', ()=>{
    stateManager.updateApplicationState('connection', 'connected');
    console.log('\x1b[32mApplication connected\x1b[37m');
});

ipc.on('disconnected', ()=>{
    stateManager.updateApplicationState('connection', 'disconnected');
    console.error('\x1b[33mApplication disconnected\x1b[37m');
});

setInterval(()=>{
    ipc.send({ping:'ping'});
},2000)


// ToDo: Update state with system version etc!
async function setDeviceState() {
    try{
        const sysAppInfo = await system_getApplicationInfo()
        stateManager.updateSystemState('version', sysAppInfo?.version );
    } catch( err ){
        console.error('\x1b[33mDevice State not updated '+err+'\x1b[37m');
    }
}
setDeviceState();

// When we got here, the system has started
stateManager.updateSystemState('state', 'running');