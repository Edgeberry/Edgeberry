/*
 *  Edge Gateway
 */

import { readFileSync } from "fs";
import { AzureClient } from "./azure";

const express = require('express');

const app = express();

app.use(express.static( __dirname+'/public'));

app.get('/', (req:any, res:any)=>{
    return res.sendFile('index.html');
});

app.listen( 8080, ()=>{ console.log('Edge Gateway UI server running on port 8080')});

/* Azure IoT Hub Connection */
const settings = JSON.parse(readFileSync('settings.json').toString());
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