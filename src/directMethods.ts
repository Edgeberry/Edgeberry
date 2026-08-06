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
     *  interface reads. This used to shell out to iwgetid and ifconfig, which
     *  was a second implementation that could disagree with the first.
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
     *  Application lifecycle — not implemented
     *
     *  Managing the lifecycle of the application a device runs needs a decision
     *  about what an "application" is here (a systemd unit? a container?) that
     *  has not been made yet.
     *
     *  These stay registered and answer 501 rather than being removed: the
     *  methods are part of the published cloud contract, and a caller is better
     *  served by an explicit "not implemented" than by a method that has
     *  silently disappeared. They previously answered 200 with the message
     *  'Not implemented', which every reasonable client reads as success.
     */
    const notImplemented = (_req:any, res:any) =>
        res.status(501).send({ message:'Not implemented' });

    cloud.registerDirectMethod('updateApplication',  notImplemented);
    cloud.registerDirectMethod('restartApplication', notImplemented);
    cloud.registerDirectMethod('stopApplication',    notImplemented);

}