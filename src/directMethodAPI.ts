/*
 *  Direct Method API
 *  Invokable methods for facilitating cloud-to-device communication using Azure's 'Direct Methods'. It provides
 *  a convenient interface for calling remote actions on the device from the Azure Cloud Platform.
 */

import { cloud } from ".";

/* Get the Azure IoT Hub connection parameters */
cloud.registerDirectMethod('getConnectionParameters',(req:any, res:any)=>{
    return res.send( cloud.getConnectionParameters() );
});

/* Update the Azure IoT Hub connection parameters */
cloud.registerDirectMethod('updateConnectionParameters', async(req:any, res:any)=>{
    // Check for the presence of the parameters in the payload
    if( !req.payload || !req.payload?.parameters )
    return res.status(400).send({message:'No parameters'});

    try{
        await cloud.updateConnectionParameters( req.payload.parameters );
        return res.send({message:'Successfully updated the Azure IoT Hub connection parameters'});
    } catch(err){
        return res.status(500).send({message:err});
    }

});
