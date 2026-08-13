/*
 *  Direct Method API
 *  Invokable methods for facilitating cloud-to-device communication. It provides
 *  a convenient interface for calling remote actions on the device from Cloud Platform.
 */

import { StateManager } from "./stateManager";
import { NetworkManager } from "./networkManager";
import { DeviceHubService } from "./deviceHub";
import { app_getApplicationInfo } from "./application";
import { board_button } from "./board";
import { system_getApplicationInfo, system_restart, system_updateApplication } from "./system";
import { registry_getManifest, registry_lifecycle } from "./applicationRegistry";
import { LifecycleAction } from "./applicationManifest";


/*
 *  Connectivity Direct API
 *  All features involving device-to-cloud connectivity
 */
export function registerDirectMethods( deviceHub:DeviceHubService, stateManager:StateManager, networkManager:NetworkManager ){
    const cloud = deviceHub.getClient();
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
            board_button.on('click',()=>{
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
            // Go through the service so the reconnection policy applies, rather
            // than calling the client directly.
            await deviceHub.connect();
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

    /*
     *  Get system network info
     *
     *  Answered from NetworkManager over D-Bus, the same source the web
     *  interface reads, so the two cannot disagree about what the device is
     *  connected to.
     */
    cloud.registerDirectMethod('getSystemNetworkInfo', async(req:any, res:any)=>{
        try{
            const [ssid, ipAddress] = await Promise.all([
                networkManager.getActiveWifiSsid(),
                networkManager.getWifiAddress(),
            ]);
            return res.send({ ssid, ipAddress });
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

    /*
     *  Application lifecycle
     *
     *  An application says how it can be managed in its manifest — a systemd
     *  unit and the actions it honours. Until one is registered, or for an
     *  action it did not declare, these answer 501: what a device can do to its
     *  application is the application's to state, not ours to assume.
     */
    const lifecycle = ( action:LifecycleAction ) => (_req:any, res:any) => {
        const manifest = registry_getManifest();
        if(!manifest)
            return res.status(501).send({ message:'No application is registered on this device' });
        if(!manifest.service?.supports.includes(action))
            return res.status(501).send({ message:`${manifest.name} does not support '${action}'` });

        try{
            // Answer before acting, like the reboot route does: restarting the
            // application can take the connection this reply travels over with
            // it, and a caller that never hears back cannot tell a working
            // restart from a broken device.
            res.send({ message:`${action} requested for ${manifest.name}` });
            registry_lifecycle(action);
        }
        catch(err:any){
            console.error('\x1b[31mLifecycle '+action+' failed: '+err.message+'\x1b[37m');
        }
    };

    cloud.registerDirectMethod('restartApplication', lifecycle('restart'));
    cloud.registerDirectMethod('stopApplication',    lifecycle('stop'));
    cloud.registerDirectMethod('startApplication',   lifecycle('start'));
    cloud.registerDirectMethod('reloadApplication',  lifecycle('reload'));

    /*
     *  Updating an application is still not implemented: where a new version
     *  comes from is a packaging question the manifest does not answer.
     */
    cloud.registerDirectMethod('updateApplication', (_req:any, res:any) =>
        res.status(501).send({ message:'Not implemented' }));

}