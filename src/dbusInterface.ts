/*
 *  D-Bus interface
 *  D-Bus is an IPC that is present by default on most Linux distributions. It
 *  lets applications call each other (remote procedure calls) and broadcast
 *  events (signals).
 *
 *  This module exposes the `io.edgeberry.Core` service that the Python, Node
 *  and Node-RED SDKs bind to. That name is a published API — renaming it or
 *  changing a method signature breaks every application on every device.
 *
 *  The policy file `edgeberry-core.conf` must be installed to
 *  /etc/dbus-1/system.d/ for the service name to be claimable.
 *
 *  Command-line example:
 *      dbus-send --system --print-reply --dest=io.edgeberry.Core \
 *                /io/edgeberry/Core io.edgeberry.Core.Identify
 */

import { StateManager } from './stateManager';
import { DeviceHubService } from './deviceHub';
import { app_getApplicationInfo, app_setApplicationInfo, app_setApplicationStatus, ApplicationInfoInput, ApplicationStatus } from './application';
import { registry_applyRoutes, registry_claimDeviceName, registry_getApplication, registry_register, registry_unregister } from './applicationRegistry';

var dbus = require('dbus-native');      // No TypeScript implementation (!)

const serviceName = 'io.edgeberry.Core';
const objectPath = '/io/edgeberry/Core';
const interfaceName = 'io.edgeberry.Core';

export type DbusDeps = {
    stateManager: StateManager;
    deviceHub:    DeviceHubService;
};

/*
 *  The bus connection is module-level state because the signal emitters below
 *  are free functions called from elsewhere in the application. It is assigned
 *  by start(), so importing this module does not connect to the system bus.
 */
let systemBus:any = null;

/**
 * Claim the service name, export the interface, and subscribe to the system
 * signals we care about.
 *
 * Takes its dependencies as arguments. This module previously reached back into
 * main.ts with `require('./main')` at each call site — six of them — purely to
 * dodge the import cycle that created.
 */
export function startDbusInterface( deps:DbusDeps ):void{
    const { stateManager, deviceHub } = deps;

    systemBus = dbus.systemBus();
    if(systemBus)
        console.log('\x1b[32mD-Bus client connected to system bus\x1b[30m');
    else
        return console.log('\x1b[31mD-Bus client could not connect to system bus\x1b[30m');

    systemBus.requestName(serviceName, 0, (err:string|null, res:number|null)=>{
        if(err)
            return console.log('\x1b[31mD-Bus service name aquisition failed: '+err+'\x1b[30m');
        else if( res )
            return console.log('\x1b[32mD-Bus service name "'+serviceName+'" successfully aquired \x1b[30m');
    });

    /*
     *  The exported service object.
     *  Every method takes and returns a JSON string ('s'), which is what the
     *  published SDKs expect.
     */
    const serviceObject = {
        Identify: ()=>{
            console.log('Device identification requested via D-Bus');
            stateManager.interruptIndicators('identify');
            return;
        },
        SetApplicationInfo:(arg:string)=>{
            try{
                app_setApplicationInfo(JSON.parse(arg.toString()) as ApplicationInfoInput);
                // The routes an application declares are what nginx proxies to
                // the port its manifest registered, so a declaration is also a
                // routing change. No-ops when nothing about them changed.
                registry_applyRoutes(app_getApplicationInfo()?.routes ?? []);
                return 'ok';
            }
            catch(err){
                return 'err';
            }
        },
        SetApplicationStatus:(arg:string)=>{
            try{
                const status = JSON.parse(arg.toString()) as ApplicationStatus;
                // Keep the whole status: the severity alone says something is
                // wrong, the message says what. Only the severity goes to the
                // StateManager, which drives the LED and buzzer.
                app_setApplicationStatus(status);
                stateManager.updateApplicationState('health', status.level );
                return 'ok';
            }
            catch(err){
                return 'err';
            }
        },
        SendMessage:(arg:string)=>{
            try{
                const data = JSON.parse(arg.toString());
                try{
                    deviceHub.sendTelemetry(data);
                    return 'ok';
                } catch(sendErr:any){
                    console.error('Cannot send message:', sendErr.message);
                    return 'err:not_connected';
                }
            }
            catch(err){
                console.error('SendMessage error:', err);
                return 'err:invalid_data';
            }
        },
        GetState:()=>{
            try{
                return JSON.stringify(stateManager.getState());
            }
            catch(err){
                console.error('GetState error:', err);
                return '';
            }
        },

        /*
         *  Application registration.
         *
         *  The CLI calls these rather than editing settings.json, so the Core
         *  stays the only writer — see applicationRegistry.ts. Errors come back
         *  as text because whoever ran `edgeberry --register-application` is the
         *  one who has to act on them.
         */
        RegisterApplication:(arg:string)=>{
            try{
                const application = registry_register(arg.toString().trim());
                return 'ok:'+application.manifest.name;
            }
            catch(err:any){
                console.error('\x1b[31mRegisterApplication failed:', err.message, '\x1b[37m');
                return 'err:'+err.message;
            }
        },
        UnregisterApplication:()=>{
            try{
                registry_unregister();
                return 'ok';
            }
            catch(err:any){
                console.error('\x1b[31mUnregisterApplication failed:', err.message, '\x1b[37m');
                return 'err:'+err.message;
            }
        },
        GetApplication:()=>{
            try{
                return JSON.stringify(registry_getApplication());
            }
            catch(err){
                console.error('GetApplication error:', err);
                return 'null';
            }
        },

        /*
         *  Take back the device name after a manual rename.
         *
         *  Edgeberry stops naming a device the moment someone renames it by
         *  hand, and that is permanent by design — this is the way back, and it
         *  is deliberately something a person asks for from the CLI rather than
         *  something an application can do to a device it was given.
         */
        ClaimHostname:()=>{
            try{
                return 'ok:'+registry_claimDeviceName();
            }
            catch(err:any){
                console.error('\x1b[31mClaimHostname failed:', err.message, '\x1b[37m');
                return 'err:'+err.message;
            }
        },
    };

    // exportInterface mutates serviceObject; it does not return anything.
    systemBus.exportInterface( serviceObject, objectPath, {
        name: interfaceName,
        methods: {
            Identify:['',''],
            SetApplicationInfo:['s','s'],
            SetApplicationStatus:['s','s'],
            SendMessage:['s','s'],
            GetState:['','s'],
            RegisterApplication:['s','s'],
            UnregisterApplication:['','s'],
            GetApplication:['','s'],
            ClaimHostname:['','s'],
        },
        signals: {
            CloudMessage: ['s'],   // cloud-to-device message
            ButtonEvent:  ['s'],   // click | pressrelease | apToggle | longpress | verylongpress
            StateUpdate:  ['s']    // full deviceState, on every change
        }
    });

    subscribeToShutdown(stateManager);
}

/*
 *  Signal emitters
 *  Safe to call before start(): they no-op rather than throwing, so a device
 *  without a usable system bus still runs.
 */

function emitSignal( name:string, payload:string ):void{
    if(!systemBus) return;
    try{
        systemBus.sendSignal(objectPath, interfaceName, name, 's', [payload]);
    } catch(err){
        console.error('\x1b[31mFailed to emit '+name+':\x1b[30m', err);
    }
}

/** Cloud-to-device message, for applications listening over D-Bus. */
export function emitCloudMessage( message:any ):void{
    emitSignal('CloudMessage', JSON.stringify(message));
}

/** Hardware button event: click | pressrelease | apToggle | longpress | verylongpress */
export function emitButtonEvent( event:string ):void{
    emitSignal('ButtonEvent', JSON.stringify({ event, timestamp: Date.now() }));
}

/** Full device state, emitted on every change so subscribers can pick fields. */
export function emitStateUpdate( state:any ):void{
    emitSignal('StateUpdate', JSON.stringify(state));
}

/*
 *  System integration
 */

/*
 *  Why the device's hostname is not set from here.
 *
 *  systemd exposes org.freedesktop.hostname1, and this module already calls
 *  another system service over the bus (login1, below). Renaming the device
 *  through SetStaticHostname/SetHostname would fit here in every respect but
 *  one: hostname1 owns /etc/hostname, and nothing owns /etc/hosts.
 *
 *  Raspberry Pi OS resolves the machine's own name from the '127.0.1.1' line in
 *  /etc/hosts and from nowhere else — its nsswitch.conf is
 *  'hosts: files mdns4_minimal [NOTFOUND=return] dns', with no 'myhostname' to
 *  synthesise an answer the way Ubuntu's does. A device renamed through
 *  hostname1 alone stops resolving itself: every sudo prints 'unable to resolve
 *  host', and anything looking up its own name waits for DNS to fail first.
 *
 *  So hostname.ts calls 'raspi-config nonint do_hostname' instead. That is not
 *  the non-D-Bus route — raspi-config runs hostnamectl itself, which is this
 *  same interface — it is the route that also repairs /etc/hosts. The choice is
 *  between delegating to the platform's own tool and hand-editing a file that
 *  leaves the device unresolvable when it is written wrong.
 *
 *  Nor do applications set the hostname over this interface. It is declared in
 *  the manifest ('hostnamePrefix'), because it is a fact settled when the
 *  application is installed, and because the SDKs re-send SetApplicationInfo
 *  every time this service restarts — the wrong shape for something that should
 *  change once. ClaimHostname above is the one exception, and it exists for a
 *  person running the CLI, not for an application.
 */

function subscribeToShutdown( stateManager:StateManager ):void{
    systemBus.getService('org.freedesktop.login1').getInterface(
        '/org/freedesktop/login1',
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
}
