/*
 *  State Manager
 *  Keeps and oversees the device's state
 */

import EventEmitter from "events";
import { system_beepBuzzer, system_setStatusLed,
         showIdentify, showApError, showLink } from "./system.service";

// Normalise incoming state values to lowercase at ingress so all downstream
// comparisons are reliable regardless of what casing the caller uses.
function canonical(value: string | number | boolean | null | undefined): string {
    if (value === null || value === undefined) return 'unknown';
    return String(value).toLowerCase().trim();
}

// ─── Literal union types for each state field ───────────────────────────────
// ASSUMPTION: pin→color mapping is inferred from the driver (gpio26=green,
// gpio19=red, both=orange). Needs silkscreen/bench confirmation.

export type SystemState   = 'unknown' | 'starting' | 'running' | 'restarting' | 'rebooting' | 'updating';
export type ProvisionState = 'unknown' | 'disabled' | 'provisioned' | 'not provisioned' | 'provisioning';
export type ConnectionState = 'unknown' | 'connected' | 'disconnected' | 'connecting';
export type NetworkState  = 'unknown' | 'connected' | 'disconnected';
export type WifiState     = 'unknown' | 'ap_mode' | 'connected' | 'disconnected';
// Lifecycle state of the application process (Running | Restarting | Stopping | Stopped)
export type AppLifecycleState = 'unknown' | 'running' | 'restarting' | 'stopping' | 'stopped';
// Health/severity reported by the application over IPC.
// NOTE: This is a separate concern from the lifecycle state above. The
// indicator switch reads this field. Currently no IPC path sets it — callers
// must call updateApplicationState('health', ...) when the application reports
// its health. Flagged for human review: confirm which model is correct.
export type AppHealthState = 'unknown' | 'ok' | 'warning' | 'critical' | 'emergency';

export type deviceState = {
    system:{
        platform: string;               // hardware platform
        state: SystemState;             // unknown | starting | running | restarting | rebooting | updating
        version: string;                // e.g. 1.1.0
        board: string|null;             // e.g. 'Edgeberry'
        board_version: string|null;     // e.g. '1.2'
        uuid: string|null;              // RFC4122 UUID from EEPROM
    };
    connection:{
        state: string;                  // overall connection state (informational)
        provision: ProvisionState;      // disabled | provisioned | not provisioned | provisioning
        connection: ConnectionState;    // connected | disconnected | connecting
        network: NetworkState;          // connected | disconnected
        wifi: WifiState;                // ap_mode | connected | disconnected
    };
    application:{
        state: AppLifecycleState;       // running | restarting | stopping | stopped
        health: AppHealthState;         // ok | warning | critical | emergency (drives LED/buzzer)
        connection: string;             // IPC connection state: connected | disconnected
        version: string;                // e.g. 2.2.1
    };
}

export class StateManager extends EventEmitter{
    private state:deviceState;
    private statusBeepInterval: NodeJS.Timeout | null = null;
    private statusBeepIntervalMs: number | null = null;

    constructor(){
        super();
        // Initialize the state
        this.state = {
            system:{
                platform: 'unknown',
                state: 'unknown',
                version: 'unknown',
                board: 'unknown',
                board_version: 'unknown',
                uuid: 'unknown'
            },
            connection:{
                state: 'unknown',
                provision: 'unknown',
                connection: 'unknown',
                network: 'unknown',
                wifi: 'unknown'
            },
            application:{
                state: 'unknown',
                health: 'unknown',
                connection: 'unknown',
                version: 'unknown'
            }
        }
    }

    // Update all state components
    private updateState():void{
        this.emit('state', this.state);
        this.updateStatusIndication();
    }

    // Get the device state
    public getState():deviceState{
        return this.state;
    }

    /*
     *  State updaters
     */

    // Update the system state
    public updateSystemState( key: keyof deviceState['system'], value:string|number|boolean|null ):void{
        // update the local state — normalise to lowercase at ingress so downstream
        // comparisons are reliable regardless of the casing the caller uses.
        if( this.state.system.hasOwnProperty(key)){
            // P0 fix: was `===` (comparison whose result was discarded); must assign.
            (this.state.system as Record<string, unknown>)[key] = canonical(value);
        }
        this.updateState();
    }

    // Update the connection
    public updateConnectionState( key: keyof deviceState['connection'], value:string|number|boolean ):void{
        // update the local state
        if( this.state.connection.hasOwnProperty(key)){
            (this.state.connection as Record<string, unknown>)[key] = canonical(value);
        }
        this.updateState();
    }

    // Update the application state
    public updateApplicationState( key: keyof deviceState['application'], value:string|number|boolean ):void{
        // update the local state
        if( this.state.application.hasOwnProperty(key)){
            (this.state.application as Record<string, unknown>)[key] = canonical(value);
        }
        this.updateState();
    }

    /*
     *  Device Status Indicators
     *  The status indicators are essential to provide local visible and autdible
     *  feedback to the user about the current state of the device, in an intuitive
     *  way. This part of the code manages the status indicators.
     * 
     *  e.g.    -> slowly blinking green means intuitively 'steady, as she goes'
     *          -> red blinking fast is 'very critical error', need attention
     *          -> constant red or nothing, meaning 'I died, game over'.
     */

    // Continuously emit short beeps while the application is in a critical or
    // emergency state. Idempotent: calling with the same intervalMs while the
    // interval is already running is a no-op, so repeated state updates do not
    // reset the beep cadence.
    private startStatusBeeping(intervalMs:number):void{
        if( this.statusBeepInterval !== null && this.statusBeepIntervalMs === intervalMs ) return;
        // Different cadence requested (or first start): replace the existing interval.
        if( this.statusBeepInterval !== null ) clearInterval( this.statusBeepInterval );
        system_beepBuzzer('short');
        this.statusBeepInterval = setInterval(()=>{
            system_beepBuzzer('short');
        }, intervalMs);
        this.statusBeepIntervalMs = intervalMs;
    }

    private stopStatusBeeping():void{
        if( this.statusBeepInterval === null ) return;
        clearInterval( this.statusBeepInterval );
        this.statusBeepInterval = null;
        this.statusBeepIntervalMs = null;
    }

    private updateStatusIndication():void{
        // Compute the desired status-beep cadence (null = silent). We defer
        // applying it until the end so that repeated state updates in the same
        // critical/emergency level don't reset the beep pattern.
        let desiredBeepMs: number | null = null;

        // SYSTEM STATUS has priority over any other system
        // state, because everything else depends on it.
        if( this.state.system.state !== 'running' ){
            switch( this.state.system.state ){
                // Boot / startup: transitional orange — not the fatal constant-red.
                // P0 fix: 'unknown' and 'starting' were previously falling to the
                // default and showing constant red (the "I died" signal) on every boot.
                case 'unknown':
                case 'starting':    system_setStatusLed( 'orange', 500 );
                                    break;
                // Preforming system software update
                case 'updating':    system_setStatusLed( 'orange', 70, 'red' );
                                    break;
                // Restarting the system software
                case 'restarting':  system_setStatusLed('orange', 200 );
                                    break;
                // Rebooting the system: recoverable operation — give it a distinct
                // orange pattern, not constant red (which is reserved for fatal faults).
                // CHANGE vs before: was constant red (fatal convention, inverted).
                case 'rebooting':   system_setStatusLed( 'orange', 400, 'red' );
                                    break;
                // Internal error / unrecoverable fault — constant red is "I died, game over".
                // CHANGE vs before: was red blink 600ms (same as hub-disconnected default).
                default:            system_setStatusLed( 'red' );
                                    break;
            }
        }
        // ACCESS POINT MODE for WiFi provisioning
        else if(this.state.connection.wifi === 'ap_mode'){
            system_setStatusLed( 'orange', true, undefined, undefined, true );
        }
        // CLOUD CONNECTION STATUS is next in line, if the system is
        // ok. For most IoT application, a constant connection to the
        // cloud is an essential aspect.
        // Network down: red blink 500ms — slower than hub-loss to be visually distinct.
        else if(this.state.connection.network !== 'connected') system_setStatusLed('red', 500 );
        else if( this.state.connection.provision === 'disabled' ||
                 this.state.connection.provision === 'provisioned'){

            switch(this.state.connection.connection){
                // Connecting
                case 'connecting':  system_setStatusLed( 'orange', 70, 'green' );
                                    break;
                // Connected — blink twice; heartbeat. Switch on health severity.
                case 'connected':   switch(this.state.application.health){
                                        case 'ok':      system_setStatusLed( 'green', true, 'green', true);
                                                        break;
                                        case 'warning': system_setStatusLed( 'green', true, 'orange', true);
                                                        break;
                                        // Critical: fast red flash + short beeps once per second
                                        case 'critical': system_setStatusLed( 'red', 150 );
                                                        desiredBeepMs = 1000;
                                                        break;
                                        // Emergency: very fast red flash + rapid short beeps
                                        case 'emergency': system_setStatusLed( 'red', 60 );
                                                        desiredBeepMs = 250;
                                                        break;
                                        // unknown / app not yet reporting health
                                        default:        system_setStatusLed( 'green', true, 'red', true);
                                                        break;
                                    }
                                    break;
                // Hub disconnected: red blink 300ms — distinct from network-down (500ms).
                // CHANGE vs before: was 600ms default (same cadence as internal error).
                default:            system_setStatusLed( 'red', 300 );
                                    break;
            }
        }
        else if( this.state.connection.provision === 'provisioning' ){
            system_setStatusLed( 'orange', 70 );
        }
        else{
            // Explicit fallback: covers 'unknown', 'not provisioned', and any
            // future provision states — must never silently keep the previous light.
            // Orange = transitional/degraded: provisioning hasn't started yet.
            system_setStatusLed( 'orange', 600 );
        }

        // Apply the desired beep pattern (or silence).
        if( desiredBeepMs === null ) this.stopStatusBeeping();
        else this.startStatusBeeping(desiredBeepMs);
    }

    // Interrupt te status indicators for a special event
    public interruptIndicators( event?:string ){
        switch( event ){
            // Device identifyication appears a key feature for instantly
            // knowing which device on the dashboard is which physical device
            case 'identify':    showIdentify();
                                break;
            // Just a little beep
            case 'beep':        system_beepBuzzer('short');
                                break;
            // Error when trying to exit AP mode without saved WiFi
            case 'ap_error':    showApError();
                                break;
            // When the device announces the procedure to link this
            // device to a user account on the dashboard.
            case 'link':        showLink();
                                break;
            default:            system_beepBuzzer('short');
                                break;
        }
        // return to normal
        setTimeout(() => {
            this.updateState();
        }, 1000);
    }
}