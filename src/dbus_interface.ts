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

import { stateManager } from ".";

var dbus = require('dbus-native');      // No TypeScript implementation (!)

const serviceName = 'io.edgeberry.Service';
const objectPath = '/io/edgeberry/Object';
const interfaceName = 'io.edgeberry.Interface';

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
        stateManager.interruptIndicators('identify');
        return;
    },
    AnotherMethod: (arg:string)=>{
        console.log("Another Method was called");
        console.log(arg);
        return 'this worked!'
    }
}

// Register a service object with the object path
// and define an interface with methods and signals
systemBus.exportInterface( serviceObject, objectPath, {
    name: interfaceName,
    methods: {
        Identify:['',''],
        AnotherMethod:['s','s']
    },
    signals: {}
});


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