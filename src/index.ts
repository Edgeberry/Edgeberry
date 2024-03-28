/*
 *  Edge Gateway
 */

import { readFileSync } from "fs";
import { AzureClient } from "./azure";
import express from 'express';

const app = express();

// Serve the public directory and a static HTML index file
app.use(express.static( __dirname+'/public'));
app.get('/', (req:any, res:any)=>{
    return res.sendFile('index.html');
});

app.listen( 8080, ()=>{ console.log('\x1b[32mEdge Gateway UI server running on port 8080\x1b[30m')});

/* Azure IoT Hub Connection */
try{
    console.log('\x1b[30mReading settings from settings file...\x1b[37m');
    var settings = JSON.parse(readFileSync('settings.json').toString());
    console.log('\x1b[32mSettings read from settings file \x1b[37m');
} catch(err){
    console.error('\x1b[31mCould not read settings file! \x1b[37m');
    // ToDo: create settings file?
}
console.log(settings);

const cloud = new AzureClient();

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
    let connectionParameters = cloud.getConnectionParameters();
    console.log('\x1b[32mConnected to Azure IoT Hub: '+connectionParameters?.deviceId+' @ '+connectionParameters?.hostName+' ('+connectionParameters?.authenticationType+') \x1b[37m');
});

cloud.on('provisioning', ()=>{
    console.log('\x1b[30mProvisioning the Azure IoT Client... \x1b[37m');
});

cloud.on('provisioned', ()=>{
    console.log('\x1b[32mProvisioning from Device Provisioning Service for Azure IoT Hub succeeded!\x1b[37m');
});

cloud.on('connecting', ()=>{
    console.log('\x1b[30mConnecting to Azure IoT Hub... \x1b[37m');
});

cloud.on('error', (error)=>{
    console.error('\x1b[31mAzure: '+error+'\x1b[37m');
});

cloud.on('warning', (warning)=>{
    console.error('\x1b[33mAzure: '+warning+'\x1b[37m');
});