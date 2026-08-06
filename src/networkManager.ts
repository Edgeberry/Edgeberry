/*
 *  Network Manager
 *  Interface to NetworkManager over D-Bus for WiFi provisioning.
 *  Provides WiFi scanning, Access Point mode, and connection management
 *  for the Edgeberry device's provisioning flow.
 *
 *  Two triggers lead to AP mode:
 *    1. On boot: no saved WiFi connection → enter AP mode automatically
 *    2. On user request: physical button held → enter AP mode
 *
 *  Once the user selects a network and provides credentials via the captive
 *  portal, the device connects and tears down the AP.
 */

import EventEmitter from "events";

var dbus = require('dbus-native');

/*
 *  D-Bus constants
 */
const NM_SERVICE             = 'org.freedesktop.NetworkManager';
const NM_PATH                = '/org/freedesktop/NetworkManager';
const NM_IFACE               = 'org.freedesktop.NetworkManager';
const NM_SETTINGS_PATH       = '/org/freedesktop/NetworkManager/Settings';
const NM_SETTINGS_IFACE      = 'org.freedesktop.NetworkManager.Settings';
const NM_CONNECTION_IFACE    = 'org.freedesktop.NetworkManager.Settings.Connection';
const NM_DEVICE_IFACE        = 'org.freedesktop.NetworkManager.Device';
const NM_WIRELESS_IFACE      = 'org.freedesktop.NetworkManager.Device.Wireless';
const NM_AP_IFACE            = 'org.freedesktop.NetworkManager.AccessPoint';
const NM_ACTIVE_CONN_IFACE   = 'org.freedesktop.NetworkManager.Connection.Active';
const NM_IP4CONFIG_IFACE     = 'org.freedesktop.NetworkManager.IP4Config';
const DBUS_PROPS_IFACE       = 'org.freedesktop.DBus.Properties';

// NetworkManager device type for WiFi
const NM_DEVICE_TYPE_WIFI = 2;

// NetworkManager active connection states
const NM_ACTIVE_STATE_ACTIVATED   = 2;
const NM_ACTIVE_STATE_DEACTIVATED = 4;

// NetworkManager device states (subset)
// https://networkmanager.dev/docs/api/latest/nm-dbus-types.html#NMDeviceState
const NM_DEVICE_STATE_DISCONNECTED = 30;
const NM_DEVICE_STATE_ACTIVATED    = 100;

/**
 * NetworkManager's assessment of internet reachability (NMConnectivityState).
 * Only 'full' means traffic actually reaches the internet.
 */
export type Connectivity = 'unknown' | 'none' | 'portal' | 'limited' | 'full';

const NM_CONNECTIVITY: Record<number, Connectivity> = {
    1: 'none',
    2: 'portal',
    3: 'limited',
    4: 'full',
};

export type AccessPointInfo = {
    ssid: string;
    strength: number;
    frequency: number;
    secured: boolean;
}

export class NetworkManager extends EventEmitter {
    private systemBus: any;
    private wifiDevicePath: string | null = null;
    private activeApConnectionPath: string | null = null;
    private activeApSettingsPath: string | null = null;

    constructor(){
        super();
        this.systemBus = dbus.systemBus();
        if(!this.systemBus)
            console.error('\x1b[31mNetworkManager: Could not connect to system bus\x1b[37m');
    }

    /*
     *  D-Bus Helpers
     */

    // Get a D-Bus interface
    private getInterface( objectPath:string, interfaceName:string ):Promise<any>{
        return new Promise((resolve, reject)=>{
            this.systemBus.getService(NM_SERVICE).getInterface(objectPath, interfaceName, (err:any, iface:any)=>{
                if(err) return reject(err);
                resolve(iface);
            });
        });
    }

    // Unwrap a dbus-native variant value.
    // dbus-native returns variants as [[{type:..., child:...}], [actualValue]]
    // rather than the simpler [signature, value] some docs suggest.
    private unwrapVariant(variant: any): any {
        if(Array.isArray(variant) && variant.length === 2 &&
           Array.isArray(variant[0]) && variant[0].length > 0 &&
           typeof variant[0][0] === 'object' && variant[0][0] !== null && 'type' in variant[0][0] &&
           Array.isArray(variant[1])){
            return variant[1][0];
        }
        // Legacy/simple format [signature_string, value]
        if(Array.isArray(variant) && variant.length === 2 && typeof variant[0] === 'string'){
            return variant[1];
        }
        return variant;
    }

    // Get a single D-Bus property
    private async getProperty( objectPath:string, interfaceName:string, propertyName:string ):Promise<any>{
        const propsIface = await this.getInterface(objectPath, DBUS_PROPS_IFACE);
        return new Promise((resolve, reject)=>{
            propsIface.Get(interfaceName, propertyName, (err:any, value:any)=>{
                if(err) return reject(err);
                resolve(this.unwrapVariant(value));
            });
        });
    }

    // Get all D-Bus properties for an interface
    private async getAllProperties( objectPath:string, interfaceName:string ):Promise<any>{
        const propsIface = await this.getInterface(objectPath, DBUS_PROPS_IFACE);
        return new Promise((resolve, reject)=>{
            propsIface.GetAll(interfaceName, (err:any, props:any)=>{
                if(err) return reject(err);
                // Convert from [[key, [sig, val]], ...] to {key: val}
                const result:any = {};
                if(Array.isArray(props)){
                    for(const [key, variant] of props){
                        result[key] = this.unwrapVariant(variant);
                    }
                }
                resolve(result);
            });
        });
    }

    /*
     *  Saved Connections
     */

    // True if a connection profile is an Access Point profile (mode 'ap')
    private isApProfile( settings:any ):boolean{
        const wifiSection = settings.find((s:any)=> s[0] === '802-11-wireless');
        if(!wifiSection) return false;
        const modeEntry = wifiSection[1].find((e:any)=> e[0] === 'mode');
        return modeEntry ? this.unwrapVariant(modeEntry[1]) === 'ap' : false;
    }

    // List saved WiFi connection paths.
    // AP profiles are excluded: startAccessPoint() persists one through
    // AddAndActivateConnection, and it carries type '802-11-wireless' just
    // like a real network. Counting it would make hasSavedWifiConnection()
    // report a configured network while the AP is up, let exitApMode() pass
    // its "somewhere to return to" guard on the AP itself, and let
    // activateSavedWifiConnection() re-activate the AP (its timestamp is
    // always the freshest).
    public async listSavedWifiConnections():Promise<string[]>{
        const settingsIface = await this.getInterface(NM_SETTINGS_PATH, NM_SETTINGS_IFACE);
        const connections:string[] = await new Promise((resolve, reject)=>{
            settingsIface.ListConnections((err:any, paths:string[])=>{
                if(err) return reject(err);
                resolve(paths);
            });
        });

        const wifiConnections:string[] = [];
        for(const connPath of connections){
            try{
                const connIface = await this.getInterface(connPath, NM_CONNECTION_IFACE);
                const settings:any = await new Promise((resolve, reject)=>{
                    connIface.GetSettings((err:any, result:any)=>{
                        if(err) return reject(err);
                        resolve(result);
                    });
                });
                // settings is a{sa{sv}} -> [[sectionName, [[key, [sig, val]], ...]], ...]
                const connectionSection = settings.find((s:any)=> s[0] === 'connection');
                if(connectionSection){
                    const typeEntry = connectionSection[1].find((e:any)=> e[0] === 'type');
                    const typeVal = typeEntry ? this.unwrapVariant(typeEntry[1]) : null;
                    if(typeVal === '802-11-wireless' && !this.isApProfile(settings)){
                        wifiConnections.push(connPath);
                    }
                }
            } catch(err){}
        }
        return wifiConnections;
    }

    // Return SSID + autoconnect flag for every saved WiFi profile
    public async getSavedWifiNetworks():Promise<{ ssid:string; autoconnect:boolean }[]>{
        const paths = await this.listSavedWifiConnections();
        const result:{ ssid:string; autoconnect:boolean }[] = [];
        for(const connPath of paths){
            try{
                const connIface = await this.getInterface(connPath, NM_CONNECTION_IFACE);
                const settings:any = await new Promise((resolve, reject)=>{
                    connIface.GetSettings((err:any, s:any)=>{ if(err) return reject(err); resolve(s); });
                });
                const wifiSection  = settings.find((s:any)=> s[0] === '802-11-wireless');
                const connSection  = settings.find((s:any)=> s[0] === 'connection');
                if(!wifiSection) continue;
                const ssidEntry    = wifiSection[1].find((e:any)=> e[0] === 'ssid');
                const ssid         = ssidEntry ? Buffer.from(this.unwrapVariant(ssidEntry[1])).toString('utf-8') : '?';
                const acEntry      = connSection?.[1].find((e:any)=> e[0] === 'autoconnect');
                const autoconnect  = acEntry ? Boolean(this.unwrapVariant(acEntry[1])) : true;
                result.push({ ssid, autoconnect });
            } catch(_e){}
        }
        return result;
    }

    // Check if any saved WiFi connection exists (for the boot check)
    public async hasSavedWifiConnection():Promise<boolean>{
        const connections = await this.listSavedWifiConnections();
        return connections.length > 0;
    }

    // Delete AP profiles left behind by a previous run. stopAccessPoint()
    // removes the profile it created, but the path is tracked in memory only,
    // so losing power while in AP mode orphans it. Called once at boot before
    // deciding whether the device has a network configured.
    public async deleteOrphanedApProfiles():Promise<number>{
        const settingsIface = await this.getInterface(NM_SETTINGS_PATH, NM_SETTINGS_IFACE);
        const connections:string[] = await new Promise((resolve, reject)=>{
            settingsIface.ListConnections((err:any, paths:string[])=>{
                if(err) return reject(err);
                resolve(paths);
            });
        });

        let deleted = 0;
        for(const connPath of connections){
            try{
                const connIface = await this.getInterface(connPath, NM_CONNECTION_IFACE);
                const settings:any = await new Promise((resolve, reject)=>{
                    connIface.GetSettings((err:any, s:any)=>{ if(err) return reject(err); resolve(s); });
                });
                if(!this.isApProfile(settings)) continue;
                await this.deleteConnection(connPath);
                deleted++;
            } catch(_e){}
        }
        if(deleted > 0)
            console.log('\x1b[33mNetworkManager: removed '+deleted+' orphaned AP profile(s)\x1b[37m');
        return deleted;
    }

    // Delete a saved connection by path
    public async deleteConnection( connectionPath:string ):Promise<void>{
        const connIface = await this.getInterface(connectionPath, NM_CONNECTION_IFACE);
        return new Promise((resolve, reject)=>{
            connIface.Delete((err:any)=>{
                if(err) return reject(err);
                resolve();
            });
        });
    }

    // Return the SSID of the currently active WiFi connection, or null
    public async getActiveWifiSsid():Promise<string|null>{
        try{
            const devicePath = await this.getWifiDevicePath();
            const activeConnPath = await this.getProperty(devicePath, NM_DEVICE_IFACE, 'ActiveConnection');
            if(!activeConnPath || activeConnPath === '/') return null;
            const connPath = await this.getProperty(activeConnPath, NM_ACTIVE_CONN_IFACE, 'Connection');
            if(!connPath || connPath === '/') return null;
            const connIface = await this.getInterface(connPath, NM_CONNECTION_IFACE);
            const settings:any = await new Promise((resolve, reject)=>{
                connIface.GetSettings((err:any, s:any)=>{ if(err) return reject(err); resolve(s); });
            });
            const wifiSection = settings.find((s:any)=> s[0] === '802-11-wireless');
            if(!wifiSection) return null;
            const ssidEntry = wifiSection[1].find((e:any)=> e[0] === 'ssid');
            return ssidEntry ? Buffer.from(this.unwrapVariant(ssidEntry[1])).toString('utf-8') : null;
        } catch(_e){ return null; }
    }

    /**
     * The IPv4 address of the WiFi interface, or null when it has none.
     *
     * Read from NetworkManager rather than by parsing `ifconfig`: net-tools is
     * not installed by default on current Raspberry Pi OS, and the interface is
     * not reliably named wlan0.
     */
    public async getWifiAddress():Promise<string|null>{
        try{
            const devicePath = await this.getWifiDevicePath();
            const ip4ConfigPath = await this.getProperty(devicePath, NM_DEVICE_IFACE, 'Ip4Config');
            if(!ip4ConfigPath || ip4ConfigPath === '/') return null;

            // AddressData is an array of dictionaries, primary address first.
            // dbus-native hands each dictionary back as an array of
            // [key, variant] pairs rather than as an object.
            const addressData = await this.getProperty(ip4ConfigPath, NM_IP4CONFIG_IFACE, 'AddressData');
            if(!Array.isArray(addressData) || addressData.length === 0) return null;

            const entry = addressData[0];
            if(!Array.isArray(entry)) return null;
            const address = entry.find((pair:any)=> Array.isArray(pair) && pair[0] === 'address');
            return address ? String(this.unwrapVariant(address[1])) : null;
        } catch(_e){ return null; }
    }

    // Set IPv4 config for a saved connection profile by SSID.
    // mode: 'auto' (DHCP) | 'manual' (static)
    // For static: address, prefix (0-32), gateway, dns (comma-separated) required.
    public async setWifiIpConfig( ssid:string, mode:'auto'|'manual', address?:string, prefix?:number, gateway?:string, dns?:string ):Promise<void>{
        const paths = await this.listSavedWifiConnections();
        for(const connPath of paths){
            const connIface = await this.getInterface(connPath, NM_CONNECTION_IFACE);
            const settings:any = await new Promise((resolve, reject)=>{
                connIface.GetSettings((err:any, s:any)=>{ if(err) return reject(err); resolve(s); });
            });
            const wifiSection = settings.find((s:any)=> s[0] === '802-11-wireless');
            if(!wifiSection) continue;
            const ssidEntry = wifiSection[1].find((e:any)=> e[0] === 'ssid');
            const profileSsid = ssidEntry ? Buffer.from(this.unwrapVariant(ssidEntry[1])).toString('utf-8') : null;
            if(profileSsid !== ssid) continue;

            // Build new settings object — preserve all sections except ipv4 which we replace
            const newSettings = settings.filter((s:any)=> s[0] !== 'ipv4');
            if(mode === 'auto'){
                newSettings.push(['ipv4', [['method', ['s', 'auto']]]]);
            } else {
                if(!address || prefix === undefined || !gateway) throw new Error('address, prefix, gateway required for static');
                const dnsServers = (dns||'').split(',').map(d=>d.trim()).filter(Boolean).map(d=>{
                    const parts = d.split('.').map(Number);
                    return (parts[0]<<24)|(parts[1]<<16)|(parts[2]<<8)|parts[3];
                });
                const addrParts = address.split('.').map(Number);
                const addrInt = (addrParts[0]<<24)|(addrParts[1]<<16)|(addrParts[2]<<8)|addrParts[3];
                const gwParts = gateway.split('.').map(Number);
                const gwInt = (gwParts[0]<<24)|(gwParts[1]<<16)|(gwParts[2]<<8)|gwParts[3];
                newSettings.push(['ipv4', [
                    ['method',    ['s', 'manual']],
                    ['addresses', ['aau', [[[addrInt, prefix, gwInt]]]]],
                    ['dns',       ['au', [dnsServers]]],
                ]]);
            }
            await new Promise<void>((resolve, reject)=>{
                connIface.Update(newSettings, (err:any)=>{ if(err) return reject(err); resolve(); });
            });
            return;
        }
        throw new Error(`No saved connection found for SSID: ${ssid}`);
    }

    /*
     *  WiFi Device
     */

    // Get the D-Bus path of the WiFi device (DeviceType === 2)
    public async getWifiDevicePath():Promise<string>{
        if(this.wifiDevicePath) return this.wifiDevicePath;

        const nmIface = await this.getInterface(NM_PATH, NM_IFACE);
        const devices:string[] = await new Promise((resolve, reject)=>{
            nmIface.GetDevices((err:any, paths:string[])=>{
                if(err) return reject(err);
                resolve(paths);
            });
        });

        for(const devicePath of devices){
            try{
                const deviceType = await this.getProperty(devicePath, NM_DEVICE_IFACE, 'DeviceType');
                if(deviceType === NM_DEVICE_TYPE_WIFI){
                    this.wifiDevicePath = devicePath;
                    return devicePath;
                }
            } catch(err){}
        }

        throw new Error('No WiFi device found');
    }

    /*
     *  WiFi Scanning
     */

    // Trigger a WiFi scan
    public async requestScan():Promise<void>{
        const devicePath = await this.getWifiDevicePath();
        const wirelessIface = await this.getInterface(devicePath, NM_WIRELESS_IFACE);
        return new Promise((resolve, reject)=>{
            wirelessIface.RequestScan([], (err:any)=>{
                if(err) return reject(err);
                resolve();
            });
        });
    }

    // Read discovered access points, deduplicate by SSID, sort by strength
    public async getAccessPoints():Promise<AccessPointInfo[]>{
        const devicePath = await this.getWifiDevicePath();
        const wirelessIface = await this.getInterface(devicePath, NM_WIRELESS_IFACE);

        const apPaths:string[] = await new Promise((resolve, reject)=>{
            wirelessIface.GetAccessPoints((err:any, paths:string[])=>{
                if(err) return reject(err);
                resolve(paths);
            });
        });

        const accessPoints:AccessPointInfo[] = [];
        for(const apPath of apPaths){
            try{
                const props = await this.getAllProperties(apPath, NM_AP_IFACE);
                // Ssid is a byte array
                const ssid = Buffer.from(props.Ssid).toString('utf-8');

                // Skip hidden networks (empty SSID)
                if(!ssid || ssid.length === 0) continue;

                const strength   = props.Strength;
                const frequency  = props.Frequency;
                const flags      = props.Flags    || 0;
                const wpaFlags   = props.WpaFlags || 0;
                const rsnFlags   = props.RsnFlags || 0;
                const secured    = (flags & 0x1) !== 0 || wpaFlags !== 0 || rsnFlags !== 0;

                accessPoints.push({ ssid, strength, frequency, secured });
            } catch(err){}
        }

        // Deduplicate by SSID, keeping the strongest signal for each
        const deduped = new Map<string, AccessPointInfo>();
        for(const ap of accessPoints){
            const existing = deduped.get(ap.ssid);
            if(!existing || ap.strength > existing.strength){
                deduped.set(ap.ssid, ap);
            }
        }

        // Sort by signal strength descending
        return Array.from(deduped.values()).sort((a, b) => b.strength - a.strength);
    }

    /*
     *  Access Point Mode
     */

    // Derive the AP SSID from the board UUID: EDGB-XXXXXX (first 6 hex chars).
    // Static so callers can display the name without the AP being up.
    public static apSsidFromUUID( hardwareUUID:string ):string{
        return 'EDGB-' + hardwareUUID.replace(/-/g, '').substring(0, 6);
    }

    // Start an open AP. SSID format: EDGB-XXXXXX (first 6 chars of hardware UUID)
    public async startAccessPoint( hardwareUUID:string ):Promise<void>{
        const devicePath = await this.getWifiDevicePath();
        const nmIface = await this.getInterface(NM_PATH, NM_IFACE);

        const apSsid = NetworkManager.apSsidFromUUID(hardwareUUID);

        const connectionSettings = [
            ['connection', [
                ['type',        ['s', '802-11-wireless']],
                ['autoconnect', ['b', false]]
            ]],
            ['802-11-wireless', [
                ['ssid', ['ay', [...Buffer.from(apSsid)]]],
                ['mode', ['s', 'ap']],
                ['band', ['s', 'bg']]
            ]],
            ['ipv4', [
                ['method', ['s', 'shared']]
            ]]
        ];

        return new Promise((resolve, reject)=>{
            nmIface.AddAndActivateConnection(connectionSettings, devicePath, '/', (err:any, settingsPath:string, activeConnectionPath:string)=>{
                if(err) return reject(err);
                this.activeApSettingsPath = settingsPath;
                this.activeApConnectionPath = activeConnectionPath;
                console.log('\x1b[32mNetworkManager: Access Point started (SSID: '+apSsid+')\x1b[37m');
                resolve();
            });
        });
    }

    // Stop the AP: deactivate and delete the temporary AP connection profile
    public async stopAccessPoint():Promise<void>{
        if(this.activeApConnectionPath){
            try{
                const nmIface = await this.getInterface(NM_PATH, NM_IFACE);
                await new Promise<void>((resolve, reject)=>{
                    nmIface.DeactivateConnection(this.activeApConnectionPath, (err:any)=>{
                        if(err) return reject(err);
                        resolve();
                    });
                });
            } catch(err){
                console.error('\x1b[31mNetworkManager: Failed to deactivate AP connection\x1b[37m');
            }
        }
        if(this.activeApSettingsPath){
            try{
                await this.deleteConnection(this.activeApSettingsPath);
            } catch(err){
                console.error('\x1b[31mNetworkManager: Failed to delete AP connection profile\x1b[37m');
            }
        }
        this.activeApConnectionPath = null;
        this.activeApSettingsPath = null;
        console.log('\x1b[32mNetworkManager: Access Point stopped\x1b[37m');
    }

    // Check if the AP is currently active
    public async isAccessPointActive():Promise<boolean>{
        if(!this.activeApConnectionPath) return false;
        try{
            const state = await this.getProperty(this.activeApConnectionPath, NM_ACTIVE_CONN_IFACE, 'State');
            return state === NM_ACTIVE_STATE_ACTIVATED;
        } catch(err){
            return false;
        }
    }

    /*
     *  Reconnect to a saved WiFi connection
     */

    // Wait until the WiFi device reaches a connectable state after AP teardown.
    // NM device state 30 (Disconnected) means the chip is back in station mode
    // and ready to accept ActivateConnection. Returns false if the timeout
    // expires before that state is reached.
    public async waitForWifiDeviceReady( timeoutMs:number = 15000 ):Promise<boolean>{
        const devicePath = await this.getWifiDevicePath();
        const pollIntervalMs = 500;
        const maxAttempts = Math.ceil(timeoutMs / pollIntervalMs);

        for(let i = 0; i < maxAttempts; i++){
            await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
            try{
                const state = await this.getProperty(devicePath, NM_DEVICE_IFACE, 'State');
                if(state >= NM_DEVICE_STATE_DISCONNECTED && state < NM_DEVICE_STATE_ACTIVATED){
                    return true;
                }
            } catch(err){
                // property read may transiently fail during transition; keep polling
            }
        }
        console.error('\x1b[31mNetworkManager: WiFi device did not become ready in time\x1b[37m');
        return false;
    }

    // Activate the most-recently-used saved WiFi connection.
    // NM stores a unix timestamp in the connection.timestamp field which we
    // use to pick the right profile — not [0] (filesystem order) which is
    // wrong if the device has multiple saved networks.
    // We call ActivateConnection explicitly because NM's autoconnect is
    // unreliable after a user-requested AP teardown (it may suppress it).
    // If NM already started autoconnecting (ActiveConnection is set), we
    // use that path instead to avoid creating a conflicting activation.
    public async activateSavedWifiConnection( timeoutMs:number = 45000 ):Promise<boolean>{
        const wifiConnections = await this.listSavedWifiConnections();
        if(wifiConnections.length === 0){
            console.error('\x1b[31mNetworkManager: No saved WiFi connections to activate\x1b[37m');
            return false;
        }

        const devicePath = await this.getWifiDevicePath();
        const nmIface = await this.getInterface(NM_PATH, NM_IFACE);

        // Pick the most recently connected profile by NM's stored timestamp
        let bestPath = wifiConnections[0];
        let bestTimestamp = 0;
        for(const connPath of wifiConnections){
            try{
                const connIface = await this.getInterface(connPath, NM_CONNECTION_IFACE);
                const settings:any = await new Promise((resolve, reject)=>{
                    connIface.GetSettings((err:any, result:any)=>{
                        if(err) return reject(err);
                        resolve(result);
                    });
                });
                const connSection = settings.find((s:any)=> s[0] === 'connection');
                if(connSection){
                    const tsEntry = connSection[1].find((e:any)=> e[0] === 'timestamp');
                    const ts = tsEntry ? Number(this.unwrapVariant(tsEntry[1])) : 0;
                    if(ts > bestTimestamp){
                        bestTimestamp = ts;
                        bestPath = connPath;
                    }
                }
            } catch(_e){}
        }

        const pollIntervalMs = 500;
        const maxAttempts = Math.ceil(timeoutMs / pollIntervalMs);

        // If NM already started autoconnecting, ride that activation instead
        let activeConnPath: string | null = null;
        try{
            const existing = await this.getProperty(devicePath, NM_DEVICE_IFACE, 'ActiveConnection');
            if(existing && existing !== '/') activeConnPath = existing;
        } catch(_e){}

        if(!activeConnPath){
            console.log('\x1b[33mNetworkManager: Activating saved WiFi connection...\x1b[37m');
            try{
                activeConnPath = await new Promise((resolve, reject)=>{
                    nmIface.ActivateConnection(bestPath, devicePath, '/', (err:any, path:string)=>{
                        if(err) return reject(err);
                        resolve(path);
                    });
                });
            } catch(err){
                // Autoconnect may have raced us; check again
                try{
                    const fallback = await this.getProperty(devicePath, NM_DEVICE_IFACE, 'ActiveConnection');
                    if(fallback && fallback !== '/'){
                        activeConnPath = fallback;
                    } else {
                        console.error('\x1b[31mNetworkManager: ActivateConnection failed: '+err+'\x1b[37m');
                        return false;
                    }
                } catch(_e){ return false; }
            }
        }

        // Poll until the active connection reaches Activated
        for(let i = 0; i < maxAttempts; i++){
            await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
            try{
                const state = await this.getProperty(activeConnPath!, NM_ACTIVE_CONN_IFACE, 'State');
                if(state === NM_ACTIVE_STATE_ACTIVATED){
                    console.log('\x1b[32mNetworkManager: Reconnected to saved WiFi\x1b[37m');
                    return true;
                }
                if(state >= NM_ACTIVE_STATE_DEACTIVATED) break;
            } catch(_err){ break; }
        }

        console.error('\x1b[31mNetworkManager: Failed to reconnect to saved WiFi\x1b[37m');
        return false;
    }

    /*
     *  Connect to a WiFi network
     */

    // Connect to a given SSID + passphrase using WPA-PSK, with autoconnect: true.
    // Polls the active connection state until Activated or Deactivated/Failed.
    // On failure, cleans up the saved connection profile.
    public async connectToNetwork( ssid:string, passphrase:string, timeoutMs:number = 30000 ):Promise<boolean>{
        const devicePath = await this.getWifiDevicePath();
        const nmIface = await this.getInterface(NM_PATH, NM_IFACE);

        const connectionSettings:any[] = [
            ['connection', [
                ['type',        ['s', '802-11-wireless']],
                ['autoconnect', ['b', true]]
            ]],
            ['802-11-wireless', [
                ['ssid', ['ay', [...Buffer.from(ssid)]]],
                ['mode', ['s', 'infrastructure']]
            ]],
            ['ipv4', [
                ['method', ['s', 'auto']]
            ]]
        ];

        // Open networks must carry no security section at all — NM rejects a
        // wpa-psk section holding an empty psk.
        if(passphrase){
            connectionSettings.push(['802-11-wireless-security', [
                ['key-mgmt', ['s', 'wpa-psk']],
                ['psk',      ['s', passphrase]]
            ]]);
        }

        const { settingsPath, activeConnectionPath } = await new Promise<{settingsPath:string, activeConnectionPath:string}>((resolve, reject)=>{
            nmIface.AddAndActivateConnection(connectionSettings, devicePath, '/', (err:any, settingsPath:string, activeConnectionPath:string)=>{
                if(err) return reject(err);
                resolve({ settingsPath, activeConnectionPath });
            });
        });

        console.log('\x1b[33mNetworkManager: Connecting to "'+ssid+'"...\x1b[37m');

        // Poll the active connection state
        const pollIntervalMs = 500;
        const maxAttempts = Math.ceil(timeoutMs / pollIntervalMs);

        for(let i = 0; i < maxAttempts; i++){
            await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
            try{
                const state = await this.getProperty(activeConnectionPath, NM_ACTIVE_CONN_IFACE, 'State');
                if(state === NM_ACTIVE_STATE_ACTIVATED){
                    console.log('\x1b[32mNetworkManager: Connected to "'+ssid+'"\x1b[37m');
                    return true;
                }
                if(state >= NM_ACTIVE_STATE_DEACTIVATED){
                    break;
                }
            } catch(err){
                break;
            }
        }

        // Connection failed - clean up the saved connection profile
        console.error('\x1b[31mNetworkManager: Failed to connect to "'+ssid+'"\x1b[37m');
        try{
            await this.deleteConnection(settingsPath);
        } catch(err){}
        return false;
    }

    // Disconnect the WiFi device
    public async disconnect():Promise<void>{
        const devicePath = await this.getWifiDevicePath();
        const deviceIface = await this.getInterface(devicePath, NM_DEVICE_IFACE);
        return new Promise((resolve, reject)=>{
            deviceIface.Disconnect((err:any)=>{
                if(err) return reject(err);
                console.log('\x1b[33mNetworkManager: WiFi disconnected\x1b[37m');
                resolve();
            });
        });
    }

    /*
     *  State Monitoring
     */

    // Subscribe to the WiFi device's StateChanged D-Bus signal.
    // Emits 'stateChanged' events with (newState, oldState).
    public async subscribeToStateChanges():Promise<void>{
        const devicePath = await this.getWifiDevicePath();
        const deviceIface = await this.getInterface(devicePath, NM_DEVICE_IFACE);
        deviceIface.on('StateChanged', (newState:number, oldState:number, _reason:number)=>{
            this.emit('stateChanged', newState, oldState);
        });
        console.log('\x1b[32mNetworkManager: Subscribed to WiFi state changes\x1b[37m');
    }

    // Map a raw NM device state number to a simple wifi status string.
    // AP mode is tracked separately by the caller (enterApMode/exitApMode).
    private nmDeviceStateToWifi(state: number): 'connected' | 'disconnected' {
        return state >= NM_DEVICE_STATE_ACTIVATED ? 'connected' : 'disconnected';
    }

    // Subscribe to WiFi connection state changes and invoke callback immediately
    // with the current state, then again on every NM device StateChanged signal.
    // Does NOT overwrite 'ap_mode' — the caller must guard against that.
    public async subscribeToWifiState(
        callback: (state: 'connected' | 'disconnected') => void
    ): Promise<void> {
        try {
            const devicePath = await this.getWifiDevicePath();
            // Read current state immediately
            try {
                const currentState = await this.getProperty(devicePath, NM_DEVICE_IFACE, 'State');
                callback(this.nmDeviceStateToWifi(currentState));
            } catch(_e) {}

            // Subscribe to future changes
            const deviceIface = await this.getInterface(devicePath, NM_DEVICE_IFACE);
            deviceIface.on('StateChanged', (newState: number) => {
                callback(this.nmDeviceStateToWifi(newState));
            });
            console.log('\x1b[32mNetworkManager: WiFi state monitoring active\x1b[37m');
        } catch(err) {
            console.error('\x1b[31mNetworkManager: Failed to subscribe to WiFi state: ' + err + '\x1b[37m');
        }
    }

    /*
     *  Internet connectivity
     *
     *  Distinct from the WiFi state above: the radio can be associated with an
     *  access point that has no route to the internet, or that intercepts
     *  traffic behind a portal. NetworkManager probes for this itself and
     *  reports the result, so we ask rather than guess.
     */

    /**
     * Watch NetworkManager's connectivity assessment.
     *
     * The callback fires once with the current value and again on every change.
     * It receives the raw assessment rather than a boolean, so callers can tell
     * "captive portal" apart from "no network at all" if they ever need to —
     * today they only care whether it is 'full'.
     */
    public async subscribeToConnectivity(
        callback: (connectivity: Connectivity) => void
    ): Promise<void> {
        try {
            const nmIface = await this.getInterface(NM_PATH, NM_IFACE);

            const report = () => {
                try {
                    nmIface.CheckConnectivity((err: any, value: number) => {
                        if (err) return;
                        const connectivity = NM_CONNECTIVITY[value] ?? 'unknown';
                        console.log('Connectivity state: ' + connectivity);
                        callback(connectivity);
                    });
                } catch(_e) {}
            };

            report();
            nmIface.on('StateChanged', report);
            console.log('\x1b[32mNetworkManager: connectivity monitoring active\x1b[37m');
        } catch(err) {
            console.error('\x1b[31mNetworkManager: Failed to subscribe to connectivity: ' + err + '\x1b[37m');
        }
    }
}
