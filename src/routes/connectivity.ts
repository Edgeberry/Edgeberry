/*
 *  REST API: Connectivity Routes
 */
import { Router } from "express";
import { cloud } from "..";
const router = Router();

/*
 *  Azure IoT Hub Connection
 */


/* Get the Azure client status */
router.get('/azure/status', (req:any, res:any)=>{
    return res.send( cloud.getClientStatus() );
});

/* Get the Azure IoT Hub connection parameters */
router.get('/azure/connectionparameters', (req:any, res:any)=>{
    return res.send( cloud.getConnectionParameters() );
});

/* Update the Azure IoT Hub connection parameters */
router.post('/azure/connectionparameters', async(req:any, res:any)=>{
    if( typeof(req.body) !== 'object' )
    return res.status(401).send({message:'No parameters'});
    
    try{
        await cloud.updateConnectionParameters( req.body );
        return res.send({message:'Connection parameters successfully updated'})
    } catch(err:any){
        return res.status(500).send({message:err.toString()});
    }
});


/* (Re)connect the device */
router.post('/azure/connect', async(req:any, res:any)=>{
    try{
        await cloud.connect();
        return res.send({message:'Connected to Azure IoT Hub'});
    } catch(err:any){
        return res.status(500).send({message:err.toString()});
    }
});

/* Send a message to Azure IoT Hub */
router.post('/azure/sendmessage', async(req:any, res:any)=>{
    // Check the required parameters
    if( typeof(req.body.message) !== 'string' || typeof(req.body.properties) === 'undefined')
    return res.status(401).send({message:'Data incomplete'});
    // Send the message
    try{
        await cloud.sendMessage( { data:req.body.message, properties:req.body.properties} );
        return res.send({message:'Message sent'})
    } catch(err:any){
        return res.status(500).send({message:err.toString()});
    }
});

/* Get the Azure Device Provisioning Service for IoT Hub provisioning parameters */
router.get('/azure/provisioningparameters', (req:any, res:any)=>{
    return res.send( cloud.getProvisioningParameters() );
});

/* Update the Azure Device Provisioning Service for IoT Hub provisioning parameters */
router.post('/azure/provisioningparameters', async(req:any, res:any)=>{
    if( typeof(req.body) !== 'object' )
    return res.status(401).send({message:'No parameters'});
    
    try{
        await cloud.updateProvisioningParameters( req.body );
        return res.send({message:'Provisioning parameters successfully updated'})
    } catch(err:any){
        return res.status(500).send({message:err.toString()});
    }
});

/* (Re)provision the device */
router.post('/azure/provision', async(req:any, res:any)=>{
    try{
        // Provision Azure IoT Hub client
        await cloud.provision();
        // Connect Azure IoT Hub Client client
        await cloud.connect();
        return res.send({message:'Device successfully provisioned'});
    } catch(err:any){
        return res.status(500).send({message:err.toString()});
    }
});

export default router;