/*
 *  REST API: Application routes
 */
import { Router } from "express";
import { app_getApplicationInfo, app_restartApplication, app_stopApplication } from "../application";
const router = Router();

/* Get the system application info */
router.get('/info', (req:any, res:any)=>{
    const appinfo = app_getApplicationInfo();
    if( appinfo ) return res.send(appinfo);
    return res.status(404).send({message:'No application info available'});
});

/* Update the system application */
router.post('/update', (req:any, res:any)=>{
    return res.send({message:'TODO: implementation'});
});

/* Restart the application */
router.post('/restart', async(req:any, res:any)=>{
    try{
        const result = await app_restartApplication();
        return res.send({message:result});
    } catch( err ){
        return res.status(500).send({message:err});
    }
});

/* Stop the application */
router.post('/stop', async(req:any, res:any)=>{
    try{
        const result = await app_stopApplication();
        return res.send({message:result});
    } catch( err ){
        return res.status(500).send({message:err});
    }
});

export default router;