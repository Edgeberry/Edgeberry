/*
 *  Access Point Mode Service
 *  Orchestrates the transition between station mode (joined to a network) and
 *  access point mode (broadcasting an open network for headless setup).
 *
 *  Three things trigger AP mode, and all of them land here:
 *    - boot with no WiFi network configured
 *    - a ~3 second press of the user button
 *    - the toggle in the web interface
 *
 *  There is deliberately no automatic fallback into AP mode when a configured
 *  network becomes unreachable: a device that reconfigures itself is worse than
 *  one that waits. The button is the recovery path in that case, and it is the
 *  only one — the web interface is unreachable precisely when it would be needed.
 */

import { StateManager } from './stateManager';
import { NetworkManager } from './networkManager';
import { WebServer } from './webServer';
import { DeviceHubService } from './deviceHub';

export class ApModeService {
    constructor(
        private readonly stateManager:   StateManager,
        private readonly networkManager: NetworkManager,
        private readonly webServer:      WebServer,
        private readonly deviceHub:      DeviceHubService,
    ){}

    public isActive():boolean{
        return this.stateManager.getState().connection.wifi === 'ap_mode';
    }

    /**
     * Whether AP mode can be left. Leaving without a saved network would strand
     * the device: no station connection to fall back to, and no access point to
     * reach it through either.
     */
    public async canExit():Promise<boolean>{
        try{ return await this.networkManager.hasSavedWifiConnection(); }
        catch(_err){ return false; }
    }

    /** The SSID this device broadcasts, known whether or not the AP is up. */
    public apSsid( boardUUID:string|null ):string|null{
        return boardUUID ? NetworkManager.apSsid(boardUUID) : null;
    }

    public async enter( boardUUID:string|null ):Promise<void>{
        if(!boardUUID){
            console.error('\x1b[31mCannot start AP: no board UUID\x1b[37m');
            return;
        }
        try{
            await this.networkManager.startAccessPoint(boardUUID);
            this.stateManager.updateConnectionState('wifi', 'ap_mode');
            // Audible mark of the mode change: the LED pattern says which mode
            // the device is in, the beep says it just changed.
            this.stateManager.interruptIndicators('ap_switch');
            console.log('\x1b[33mDevice is in Access Point mode for WiFi provisioning\x1b[37m');

            // Redirect unclaimed requests so client devices raise their
            // "sign in to network" popup. Only meaningful while the device is
            // the network those clients are on.
            this.webServer.setCaptivePortalRedirect(true);
        } catch(err){
            console.error('\x1b[31mFailed to start Access Point: '+err+'\x1b[37m');
        }
    }

    public async exit():Promise<void>{
        try{
            if(!await this.canExit()){
                this.stateManager.interruptIndicators('ap_error');
                console.error('\x1b[31mCannot exit AP mode: no saved WiFi connection\x1b[37m');
                return;
            }

            this.webServer.setCaptivePortalRedirect(false);
            await this.networkManager.stopAccessPoint();
            this.stateManager.updateConnectionState('wifi', 'disconnected');
            // Beep on the way out too, at the point the access point is actually
            // down — the reconnect that follows may still take a while or fail.
            this.stateManager.interruptIndicators('ap_switch');
            console.log('\x1b[33mExited AP mode, reconnecting to WiFi...\x1b[37m');

            // The WiFi chip needs time to leave AP mode before it will accept a
            // station connection. How long varies by driver, so poll for
            // readiness rather than guessing at a sleep.
            if(!await this.networkManager.waitForWifiDeviceReady()){
                console.error('\x1b[31mWiFi device did not become ready after AP teardown\x1b[37m');
                return;
            }

            if(await this.networkManager.activateSavedWifiConnection()){
                this.stateManager.updateConnectionState('wifi', 'connected');
                console.log('\x1b[32mWiFi reconnected, resuming normal operation\x1b[37m');
                await this.deviceHub.connect();
            } else {
                console.error('\x1b[31mFailed to reconnect to WiFi after exiting AP mode\x1b[37m');
            }
        } catch(err){
            console.error('\x1b[31mFailed to exit AP mode: '+err+'\x1b[37m');
        }
    }

    /** Button and web-interface toggle share this. */
    public async toggle( boardUUID:string|null ):Promise<void>{
        if(this.isActive()){
            await this.exit();
            return;
        }
        // Drop the station connection first; the radio cannot do both.
        try{ await this.networkManager.disconnect(); } catch(_err){}
        await this.enter(boardUUID);
    }
}
