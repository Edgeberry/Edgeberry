/*
 *  REST API: Connectivity Routes
 */
import { Router } from "express";
import { cloud } from "..";
const router = Router();

/*
 *  Azure IoT Hub Connection
 */

/* Get the Azure IoT Hub connection parameters */
router.get('/azure/connectionparameters', (req:any, res:any)=>{
    return res.send( cloud.getConnectionParameters() );
});

/* Update the Azure IoT Hub connection parameters */
router.post('/azure/connectionparameters', async(req:any, res:any)=>{
    if( typeof(req.body.parameters) !== 'object' )
    return res.status(401).send({message:'No parameters'});
    
    try{
        await cloud.updateConnectionParameters( req.body.parameters );
        return res.send({message:'Connection parameters successfully updated'})
    } catch(err){
        return res.status(500).send({message:err});
    }
});

/* Send a message to Azure IoT Hub */
router.post('/azure/sendmessage', async(req:any, res:any)=>{
    // Check the required parameters
    if( typeof(req.body.message) !== 'string' || typeof(req.body.properties) === 'undefined')
    return res.status(401).send({message:'Data incomplete'});
    // Send the message
    try{
        await cloud.sendMessage( req.body.message );
        return res.send({message:'Message sent'})
    } catch(err){
        return res.status(500).send({message:err});
    }
});

/* Get the Azure Device Provisioning Service for IoT Hub provisioning parameters */
router.get('/azure/provisioningparameters', (req:any, res:any)=>{
    return res.send( cloud.getProvisioningParameters() );
});

/* Update the Azure Device Provisioning Service for IoT Hub provisioning parameters */
router.post('/azure/provisioningparameters', async(req:any, res:any)=>{
    if( typeof(req.body.parameters) !== 'object' )
    return res.status(401).send({message:'No parameters'});
    
    try{
        await cloud.updateConnectionParameters( req.body.parameters );
        return res.send({message:'Provisioning parameters successfully updated'})
    } catch(err){
        return res.status(500).send({message:err});
    }
});

export default router;