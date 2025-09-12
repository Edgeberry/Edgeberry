/*
 *  Direct Method API
 *  Invokable methods for facilitating cloud-to-device communication. It provides
 *  a convenient interface for calling remote actions on the device from Cloud Platform.
 */

import { cloud, stateManager } from "./main";
import { app_getApplicationInfo, app_restartApplication, app_stopApplication } from "./application.service";
import { system_button, system_getApplicationInfo, system_getWirelessAddress, system_getWirelessSSID, system_restart, system_updateApplication } from "./system.service";


/*
 *  Connectivity Direct API
 *  All features involving device-to-cloud connectivity
 */
export function initializeDirectMethodAPI(){
    if (!cloud) {
        console.log('Cloud client not initialized, skipping direct method registration');
        return;
    }

    /* Get the connection status */
    cloud.registerDirectMethod('getConnectionStatus',(req:any, res:any)=>{
        return res.send( cloud.getClientStatus() );
    });

    /* Connection parameters not available in new client - removed for now */
    /* Update connection parameters not available in new client - removed for now */

    /*
     *  Link To User Account
     *  When linking the device to a user account, the user must press the
     *  button in the claim procedure.
     */
    cloud.registerDirectMethod('linkToUserAccount',async(req:any, res:any)=>{
        try{
            // Indcator in link modus
            stateManager.interruptIndicators('link');
            // After 10 seconds, time's up
            setTimeout(()=>{
                return res.status(408).send( {message:'too slow'} );
            }, 10*1000);
            // Return success if the button is clicked
            system_button.on('click',()=>{
                return res.send( {message:'success'} );
            });
        }
        catch(err){
            return res.status(500).send( {message:err} );
        }
    });

    /* (re)Connect */
    cloud.registerDirectMethod('reconnect',async(req:any, res:any)=>{
        try{
            await cloud.connect();
            res.send({message:'success'});
        }
        catch(err){
            return res.status(500).send( {message:err} );
        }
    });

    /* Provisioning methods not available in new client - removed for now */
    /* TODO: Implement provisioning support with EdgeberryDeviceHubClient */

    /*
    *  System Direct API
    *  All functionality related to system operations.
    */

    /* Restart system */
    cloud.registerDirectMethod('reboot',async(req:any, res:any)=>{
        if( system_restart(2000) )
        return res.send({message:'Restarting system'});
        return res.status(500).send({message:'System restart failed'});
    });

    /* Identify System  */
    cloud.registerDirectMethod('identify',async(req:any, res:any)=>{
        stateManager.interruptIndicators('identify');
        return res.send({message:'Identifying system'});
    });

    /* Get system application info */
    cloud.registerDirectMethod('getSystemApplicationInfo', (req:any, res:any)=>{
        system_getApplicationInfo()
            .then((appInfo:any)=>{
                return res.send(appInfo);
            })
            .catch((err)=>{
                return res.status(500).send({message:err});
            });
    });

    /* Request system application update */
    cloud.registerDirectMethod('updateSystemApplication', (req:any, res:any)=>{
        system_updateApplication()
            .then((message)=>{
                return res.send({message:message});
            })
            .catch((err)=>{
                return res.status(500).send({message:err});
            });
    });

    /* Get system network info */
    cloud.registerDirectMethod('getSystemNetworkInfo', async(req:any, res:any)=>{
        try{
            const settings = {
                ssid: await system_getWirelessSSID(),
                ipAddress: await system_getWirelessAddress('wlan0')
            }
            return res.send(settings);
        }
        catch( err ){
            return res.status(500).send({message:err});
        }
    });

    /*
     *  Application
     */

    /* Get the application info */
    cloud.registerDirectMethod('getApplicationInfo', (req:any, res:any)=>{
        const appinfo = app_getApplicationInfo();
        if( appinfo ) return res.send(appinfo);
        return res.status(404).send({message:'No application info available'});
    });

    /* Update the system application */
    cloud.registerDirectMethod('updateApplication', async(req:any, res:any)=>{
        return res.send({message:'TODO: implementation'});
    });

    /* Restart the application */
    cloud.registerDirectMethod('restartApplication', async(req:any, res:any)=>{
        try{
            const result = await app_restartApplication();
            return res.send({message:result});
        } catch( err ){
            return res.status(500).send({message:err});
        }
    });

    /* Stop the application */
    cloud.registerDirectMethod('stopApplication', async(req:any, res:any)=>{
        try{
            const result = await app_stopApplication();
            return res.send({message:result});
        } catch( err ){
            return res.status(500).send({message:err});
        }
    });

}