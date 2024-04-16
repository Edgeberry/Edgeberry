/*
 *  EdgeBerry
 *  An application for using your Raspberry Pi as an edge device for your IoT project.
 * 
 *  Copyright 2024, Sanne 'SpuQ' Santens
 * 
 *  THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT 
 *  LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. 
 *  IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, 
 *  WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE 
 *  SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */


import { readFileSync } from "fs";
import express from 'express';
import { StateManager } from "./stateManager";
import cors from 'cors';
import { IPC_Client } from "@spuq/json-ipc";
// Direct Methods
//import * as directMethodAPI from "./directMethodAPI";
// Cloud clients
import { AzureClient } from "./azure";
import { AWSClient } from "./aws";
// System features
import { system_beepBuzzer, system_getApplicationInfo, system_getPlatform } from "./system";
// API routes
import connectivityRoutes from './routes/connectivity';
import systemRoutes from './routes/system';
import applicationRoutes from './routes/application';
import { initializeDirectMethodAPI } from "./directMethodAPI";

/* State Manager */
export const stateManager = new StateManager();
stateManager.updateSystemState('state', 'starting');

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
app.listen( port, ()=>{ console.log('\x1b[32mEdgeBerry UI server running on port '+port+'\x1b[30m')});


/* Azure IoT Hub Connection */
/*
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
}*/

/* AWS IoT Core */
export const cloud = new AWSClient();

async function initialize():Promise<void>{
    // initialize system state
    try{
        stateManager.updateSystemState('platform', (await system_getPlatform()) );
    }
    catch(err){}


    // Provision the device
    try{
        stateManager.updateConnectionState( 'provision', 'provisioning' );
        await cloud.updateProvisioningParameters({
            hostName: settings.provisioning.hostName,
            clientId: settings.provisioning.clientId,
            authenticationType: 'x509',
            certificate: readFileSync( settings.provisioning.certificateFile ).toString(),
            privateKey: readFileSync( settings.provisioning.privateKeyFile ).toString(),
            rootCertificate: readFileSync( settings.provisioning.rootCertificateFile ).toString()
        });
        // Provision
        await cloud.provision();
    }
    catch(err){
        console.error("Device provisioning failed: "+err);
    }

/*
    // Initialize Cloud connection
    try{
        // disable the provisioning
        stateManager.updateConnectionState( 'provision', 'disabled' );

        // Update the connection parameters from the settings
        await cloud.updateConnectionParameters({
                                                    hostName: settings.connection.hostName,
                                                    deviceId: settings.connection.deviceId,
                                                    authenticationType: 'x509',
                                                    certificate: readFileSync( settings.connection.certificateFile ).toString(),
                                                    privateKey: readFileSync( settings.connection.privateKeyFile ).toString(),
                                                    rootCertificate: readFileSync( settings.connection.rootCertificateFile ).toString()
                                                });
        // Connect the client
        await cloud.connect();
    } catch(err){
        //console.error(err);
    }*/
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


cloud.on('status', (status)=>{
    // inform the application about the status
    ipc.send( status );
});

stateManager.on('state', (state)=>{
    // Update the system state
    cloud.updateState('system', state )
        .then(()=>{})
        .catch(()=>{});
});

// Test sending messages
/*setInterval(()=>{
    cloud.sendMessage({data:'blub ik ben een string', properties:[{key:"zee", value:"meermin"}]})
},3000);*/


// Initialize Direct Method API
initializeDirectMethodAPI();

/*
 *  EdgeBerry SDK
 *  Communication with another application through 
 *  inter-process communication.
 */
const ipc = new IPC_Client( true , "EdgeBerry-SDK","./sdk-ipc");

// receiving data from the other process
ipc.on('data', async(data:any)=>{
    //console.log(data);
    // When a method is called from the IPC
    if(data?.method){
        switch(data.method){
            case 'beep':        system_beepBuzzer('short');
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
},2000);


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