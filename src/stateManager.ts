/*
 *  State Manager
 *  Keeps and oversees the device's state
 */

import EventEmitter from "events";
import { system_beepBuzzer, system_setStatusLed } from "./system";

export type deviceState = {
    system:{
        state: string;                  // Running | Restarting | Updating | Starting
        version: string;                // e.g. 1.1.0
    };
    connection:{
        state: string;                  // Provisioning | Connecting | Connected | Disconnected
        provision: string;              // Provisioned | Provisioning | Not provisioned | Disabled
        connection: string;             // Connected | Disconnected | Connecting
        network: string;                // Connected | Disconnected
    };
    application:{
        state: string;                  // Running | Restarting | Stopping | Stopped
        connection: string;             // IPC connection state: connected | disconnected
        version: string;                // e.g. 2.2.1
    };
}

export class StateManager extends EventEmitter{
    private state:deviceState;

    constructor(){
        super();
        // Initialize the state
        this.state = {
            system:{
                state: 'unknown',
                version: 'unknown'
            },
            connection:{
                state: 'unknown',
                provision: 'unknown',
                connection: 'unknown',
                network: 'unknown'
            },
            application:{
                state: 'unknown',
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
    public updateSystemState( key: keyof deviceState['system'], value:string|number|boolean ):void{
        // update the local state
        if( this.state.system.hasOwnProperty(key)){
            this.state.system[key] = typeof(value)!=='string'?value.toString():value ;
        }
        this.updateState();
    }

    // Update the connection
    public updateConnectionState( key: keyof deviceState['connection'], value:string|number|boolean ):void{
        // update the local state
        if( this.state.connection.hasOwnProperty(key)){
            this.state.connection[key] = typeof(value)!=='string'?value.toString():value ;
        }
        this.updateState();
    }

    // Update the application state
    public updateApplicationState( key: keyof deviceState['application'], value:string|number|boolean ):void{
        // update the local state
        if( this.state.application.hasOwnProperty(key)){
            this.state.application[key] = typeof(value)!=='string'?value.toString():value ;
        }
        //this.updateState();
    }

    // LED and buzzer indicators
    private updateStatusIndication():void{
        if( this.state.system.state !== 'running' ){
            system_setStatusLed( 'red' );
        }
        else if( this.state.connection.provision === 'disabled' ||
                 this.state.connection.provision === 'provisioned'){

            switch(this.state.connection.connection){
                // Connecting
                case 'connecting':  system_setStatusLed( 'orange', 70, 'green' );
                                    break;
                // Connected
                case 'connected':   system_setStatusLed( 'green', true );
                                    break;
                // Disconnected/Unknown/...
                default:            system_setStatusLed( 'red', true );
                                    break;
            }
        }
        else if( this.state.connection.provision === 'provisioning' ){
            system_setStatusLed( 'orange', 70 );
        }
    }

    // Interrupt te status indicators for a special event
    public interruptIndicators( event?:string ){
        switch( event ){
            case 'identify':    system_beepBuzzer('long');
                                system_setStatusLed( 'green', 30, 'red' );
                                break;
            case 'beep'     :   system_beepBuzzer('short');
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