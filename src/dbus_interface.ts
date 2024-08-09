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