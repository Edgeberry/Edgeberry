/*
 *  REST API: Connectivity Routes
 */
import { Router } from "express";
import { cloud } from "..";
const router = Router();

/*
 *  Azure
 */

/* Get the Azure IoT Hub connection parameters */
router.get('/azure/connectionparameters', (req:any, res:any)=>{
    return res.send( cloud.getConnectionParameters );
});

/* Update the Azure IoT Hub connection parameters */
router.post('/azure/connectionparameters', (req:any, res:any)=>{
    if( typeof(req.body.parameters) !== 'object' )
    return res.status(401).send({message:'No parameters'});
    
    try{
        cloud.updateConnectionParameters( req.body.parameters );
        return res.send({message:'Connection parameters successfuly updated'})
    } catch(err){
        return res.status(500).send({message:err});
    }
});

export default router;