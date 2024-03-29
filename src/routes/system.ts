/*
 *  REST API: System Routes
 */
import { Router } from "express";
import { system_getApplicationVersion, system_getWirelessAddress, system_getWirelessSSID } from "../system";
const router = Router();

/* Network */

/* Get the Azure Device Provisioning Service for IoT Hub provisioning parameters */
router.get('/network/settings', async(req:any, res:any)=>{
    try{
        const settings = {
            ssid: await system_getWirelessSSID(),
            ipAddress: await system_getWirelessAddress('wlan0')
        }
        return res.send(settings);
    }
    catch( err ){
        return res.static(500).send({message:err});
    }
});

/*  System Application */
router.get('/application/info', async(req:any, res:any)=>{
    try{
        const info = {
            version: await system_getApplicationVersion()
        }
        return res.send(info);
    }
    catch( err ){
        return res.static(500).send({message:err});
    }
});

export default router;