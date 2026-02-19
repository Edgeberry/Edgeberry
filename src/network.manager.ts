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
const DBUS_PROPS_IFACE       = 'org.freedesktop.DBus.Properties';

// NetworkManager device type for WiFi
const NM_DEVICE_TYPE_WIFI = 2;

// NetworkManager active connection states
const NM_ACTIVE_STATE_ACTIVATED   = 2;
const NM_ACTIVE_STATE_DEACTIVATED = 4;

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

    // List saved WiFi connection paths
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
                    if(typeVal === '802-11-wireless'){
                        wifiConnections.push(connPath);
                    }
                }
            } catch(err){}
        }
        return wifiConnections;
    }

    // Check if any saved WiFi connection exists (for the boot check)
    public async hasSavedWifiConnection():Promise<boolean>{
        const connections = await this.listSavedWifiConnections();
        return connections.length > 0;
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

    // Start an open AP. SSID format: EDGB-XXXXXX (first 6 chars of hardware UUID)
    public async startAccessPoint( hardwareUUID:string ):Promise<void>{
        const devicePath = await this.getWifiDevicePath();
        const nmIface = await this.getInterface(NM_PATH, NM_IFACE);

        const apSsid = 'EDGB-' + hardwareUUID.replace(/-/g, '').substring(0, 6);

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

    // Activate an existing saved WiFi connection profile.
    // Uses ActivateConnection (not AddAndActivateConnection) to avoid creating duplicates.
    // Returns true if the connection reaches the Activated state within the timeout.
    public async activateSavedWifiConnection( timeoutMs:number = 30000 ):Promise<boolean>{
        const wifiConnections = await this.listSavedWifiConnections();
        if(wifiConnections.length === 0){
            console.error('\x1b[31mNetworkManager: No saved WiFi connections to activate\x1b[37m');
            return false;
        }

        const devicePath = await this.getWifiDevicePath();
        const nmIface = await this.getInterface(NM_PATH, NM_IFACE);

        // Activate the first saved WiFi connection
        const connPath = wifiConnections[0];
        console.log('\x1b[33mNetworkManager: Activating saved WiFi connection...\x1b[37m');

        const activeConnPath:string = await new Promise((resolve, reject)=>{
            nmIface.ActivateConnection(connPath, devicePath, '/', (err:any, activeConnectionPath:string)=>{
                if(err) return reject(err);
                resolve(activeConnectionPath);
            });
        });

        // Poll the active connection state
        const pollIntervalMs = 500;
        const maxAttempts = Math.ceil(timeoutMs / pollIntervalMs);

        for(let i = 0; i < maxAttempts; i++){
            await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
            try{
                const state = await this.getProperty(activeConnPath, NM_ACTIVE_CONN_IFACE, 'State');
                if(state === NM_ACTIVE_STATE_ACTIVATED){
                    console.log('\x1b[32mNetworkManager: Reconnected to saved WiFi\x1b[37m');
                    return true;
                }
                if(state >= NM_ACTIVE_STATE_DEACTIVATED){
                    break;
                }
            } catch(err){
                break;
            }
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

        const connectionSettings = [
            ['connection', [
                ['type',        ['s', '802-11-wireless']],
                ['autoconnect', ['b', true]]
            ]],
            ['802-11-wireless', [
                ['ssid', ['ay', [...Buffer.from(ssid)]]],
                ['mode', ['s', 'infrastructure']]
            ]],
            ['802-11-wireless-security', [
                ['key-mgmt', ['s', 'wpa-psk']],
                ['psk',      ['s', passphrase]]
            ]],
            ['ipv4', [
                ['method', ['s', 'auto']]
            ]]
        ];

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
}
