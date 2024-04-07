/*
 *  REST API: Connectivity Routes
 */
import { Router } from "express";
import { cloud } from "..";
const router = Router();

/* Get the cloud client status */
router.get('/status', (req:any, res:any)=>{
    return res.send( cloud.getClientStatus() );
});

/* Get the connection parameters */
router.get('/connectionparameters', (req:any, res:any)=>{
    return res.send( cloud.getConnectionParameters() );
});

/* Update the connection parameters */
router.post('/connectionparameters', async(req:any, res:any)=>{
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
router.post('/connect', async(req:any, res:any)=>{
    try{
        await cloud.connect();
        return res.send({message:'Connected to cloud'});
    } catch(err:any){
        return res.status(500).send({message:err.toString()});
    }
});

/* Send a message to the cloud */
router.post('/sendmessage', async(req:any, res:any)=>{
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

/* Get the provisioning parameters */
router.get('/provisioningparameters', (req:any, res:any)=>{
    return res.send( cloud.getProvisioningParameters() );
});

/* Update provisioning parameters */
router.post('/provisioningparameters', async(req:any, res:any)=>{
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
router.post('/provision', async(req:any, res:any)=>{
    try{
        // Provision device
        await cloud.provision();
        // Connect to cloud
        await cloud.connect();
        return res.send({message:'Device successfully provisioned'});
    } catch(err:any){
        return res.status(500).send({message:err.toString()});
    }
});

export default router;