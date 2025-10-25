/*
 *  D-Bus interface
 *  D-Bus is an IPC that is by default present on most Linux distributions. It allows
 *  applications to communicate with each other (inter-process communication) through
 *  methods (remote procedure calls) and signals.
 * 
 *  D-Bus configuration file 'edgeberry-dbus.conf' should be placed in /etc/dbus-1/system.d/ 
 * 
 *  commandline examples:
 *      dbus-send --system --print-reply --dest=io.edgeberry.Service /io/edgeberry/Object io.edgeberry.Interface.Identify
 */

import { app_setApplicationInfo, ApplicationInfo } from "./application.service";

var dbus = require('dbus-native');      // No TypeScript implementation (!)

const serviceName = 'io.edgeberry.Core';
const objectPath = '/io/edgeberry/Core';
const interfaceName = 'io.edgeberry.Core';

// Connect to the session bus
const systemBus = dbus.systemBus();

if(systemBus)
    console.log('\x1b[32mD-Bus client connected to system bus\x1b[30m');
else
    console.log('\x1b[31mD-Bus client could not connect to system bus\x1b[30m');

// Request a unique service name (io.edgeberry.Service)
systemBus.requestName(serviceName,0, (err:string|null, res:number|null)=>{
    if(err)
        return console.log('\x1b[31mD-Bus service name aquisition failed: '+err+'\x1b[30m');
    else if( res )
        return console.log('\x1b[32mD-Bus service name "'+serviceName+'" successfully aquired \x1b[30m');
});

// Create the service object
const serviceObject = {
    Identify: ()=>{
        console.log('Device identification requested via D-Bus');
        // Import stateManager dynamically to avoid circular dependency
        const { stateManager } = require('./main');
        stateManager.interruptIndicators('identify');
        return;
    },
    SetApplicationInfo:(arg:string)=>{
        try{
            const info = JSON.parse(arg.toString()) as ApplicationInfo;
            app_setApplicationInfo(info);
            return 'ok';
        }
        catch(err){
            return 'err';
        }
    },
    SetApplicationStatus:(arg:string)=>{
        try{
            const status = JSON.parse(arg.toString());
            // Import stateManager dynamically to avoid circular dependency
            const { stateManager } = require('./main');
            stateManager.updateApplicationState('state', status.level );
            return 'ok';
        }
        catch(err){
            return 'err';
        }
    },
    SendMessage:(arg:string)=>{
        try{
            const data = JSON.parse(arg.toString());
            // Import cloud dynamically to avoid circular dependency
            const { cloud } = require('./main');
            if (!cloud) {
                console.error('Cannot send message: Device Hub client not initialized');
                return 'err:not_initialized';
            }
            try {
                cloud.sendTelemetry(data);
                return 'ok';
            } catch (sendErr: any) {
                console.error('Cannot send message:', sendErr.message);
                return 'err:not_connected';
            }
        }
        catch(err){
            console.error('SendMessage error:', err);
            return 'err:invalid_data';
        }
    },
    AnotherMethod: (arg:string)=>{
        console.log("Another Method was called");
        console.log(arg);
        return 'this worked!'
    }
}

// Register a service object with the object path
// and define an interface with methods and signals
// NOTE: exportInterface modifies serviceObject, it doesn't return anything
systemBus.exportInterface( serviceObject, objectPath, {
    name: interfaceName,
    methods: {
        Identify:['',''],
        SetApplicationInfo:['s','s'],
        SetApplicationStatus:['s','s'],
        SendMessage:['s','s'],
        AnotherMethod:['s','s']
    },
    signals: {
        CloudMessage: ['s']  // Signal for cloud-to-device messages
    }
});

// Export function to emit cloud messages via D-Bus signal
export function emitCloudMessage(message: any): void {
    try {
        const messageJson = JSON.stringify(message);
        
        // Emit signal using systemBus.sendSignal
        // Body must be an array of values matching signature 's' (one string)
        systemBus.sendSignal(objectPath, interfaceName, 'CloudMessage', 's', [messageJson]);
        
        console.log('\x1b[32mEmitted cloud message via D-Bus signal\x1b[30m');
    } catch (err) {
        console.error('\x1b[31mFailed to emit cloud message:\x1b[30m', err);
    }
}


/*
 *  D-Bus system interface
 */

// Listen for system shutdown event
systemBus.getService('org.freedesktop.login1').getInterface(    '/org/freedesktop/login1', 
                                                                'org.freedesktop.login1.Manager',
                                                                (err:any, iface:any)=>{
                                                                    if(err) return console.log(err);
                                                                    iface.on('PrepareForShutdown', (shutdown:boolean)=>{
                                                                        if(shutdown){
                                                                            const { stateManager } = require('./main');
                                                                            stateManager.updateSystemState('state', 'restarting');
                                                                            console.log('System shutting down');
                                                                        }
                                                                    });
                                                                }
                                                            );

/*
 *  D-Bus Network Manager
 *  concept implementation of listening for the network
 *  manager state change, and calling a method to get the
 *  current state.
 * 
 *  TODO:  This does not belong here, and is a quick POC
 *         implementation !
 */

let networkManagerInterface:any = null;

async function initializeNetworkConnectionState(){
    // Connect to the system D-Bus Network Manager interface
    try{
    systemBus.getService('org.freedesktop.NetworkManager').getInterface( '/org/freedesktop/NetworkManager',
        'org.freedesktop.NetworkManager',
        (err:string|null, iface:any)=>{
            networkManagerInterface = iface;
            // Get the current connectivity state
            updateNetworkConnectivityState();
            // Listen for state change events
            networkManagerInterface.on('StateChanged', ()=>{updateNetworkConnectivityState()} );
        }
       );
    } catch(err){}
}

function updateNetworkConnectivityState(){
    try{
        networkManagerInterface.CheckConnectivity((err:string|null, res:number)=>{
            if(err) return;
            const { stateManager } = require('./main');
            stateManager.updateConnectionState('network', res>=4?'connected':'disconnected');
            let stateName:string;
            switch(res){
                case(1):    stateName = 'None';
                            break;
                case(2):    stateName = 'Portal';
                            break;
                case(3):    stateName = 'Limited';
                            break;
                case(4):    stateName = 'Full';
                            break;
                default:    stateName = 'Unknown'
                            break;
            }
            console.log('Connectivity state: '+stateName);
        });
    } catch(err){}
}

// Initialize the network connection state
initializeNetworkConnectionState();