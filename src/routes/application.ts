/*
 *  REST API: Application routes
 */
import { Router } from "express";
import { app_getApplicationInfo } from "../application";
const router = Router();

/* Get the system application info */
router.get('/info', (req:any, res:any)=>{
    app_getApplicationInfo()
        .then((appInfo:any)=>{
            return res.send(appInfo);
        })
        .catch((err)=>{
            return res.status(500).send({message:err});
        });
});

/* Update the system application */
router.post('/update', (req:any, res:any)=>{
    return res.send({message:'TODO: implementation'});
});

/* Restart the application */
router.post('/restart', (req:any, res:any)=>{
    try{
            
            return res.send({message:'Application restarted'});
    } catch( err ){
        return res.status(500).send({message:err});
    }
});

/* Stop the application */
router.post('/stop', (req:any, res:any)=>{
    try{

        return res.send({message:'Application stopped'});
    } catch( err ){
        return res.status(500).send({message:err});
    }
});

export default router;