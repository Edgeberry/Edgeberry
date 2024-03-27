/*
 *  Azure
 *  We're using Azure for our first cloud connection.
 * 
 *  Copyright 2024  Sanne 'SpuQ' Santens
 * 
 *  Azure SDK examples:
 *      https://github.com/Azure/azure-iot-sdk-node/tree/main/device/samples/typescript
 *      https://github.com/Azure/azure-iot-sdk-node/tree/main/provisioning/device/samples
 */

import { Client } from "azure-iot-device";
import { Mqtt } from "azure-iot-device-mqtt";
import { EventEmitter } from "events";

/* Types */
export type AzureConnectionParameters = {
    hostName: string;                       // Name of the host to connect to (e.g. myIoTHub.azure-devices.net)
    deviceId: string;                       // The unique ID of this device (e.g. Edge_Gateway_01)
    authenticationType: string;             // The authentication type (e.g. 'sas', 'x509')
    sharedAccessKey?: string;               // For Shared Key authentication
    certificate?: string;                   // For X.509 authentication
    privateKey?: string;                    // for X.509 authentication
}

export type AzureClientStatus = {
    connected?: boolean;
    provisioning?: boolean;
}


export class AzureClient extends EventEmitter {
    // Azure IoT Hub connection parameters
    private connectionParameters:AzureConnectionParameters|null = null;
    // Azure IoT Hub connection status
    private clientStatus:AzureClientStatus = { connected: false, provisioning:false };
    // The Azure IoT Hub client object
    private client:any|null = null;


    constructor(){
        super();
    }

    /* Update the Azure IoT Hub connection parameters */
    public async updateConnectionParameters( parameters:AzureConnectionParameters ):Promise<string|boolean>{
        return new Promise<string|boolean>((resolve, reject)=>{
            // Check if the parameters are correct
            if( parameters.authenticationType === 'sas' && typeof(parameters.sharedAccessKey) !== 'string' )
            return reject('sas authentication requires a shared access key');
            if( parameters.authenticationType === 'x509' && (typeof(parameters.certificate ) !== 'string') || typeof(parameters.privateKey) !== 'string')
            return reject('X.509 authentication requires a certificate and private key file');
            // Set the connection parameters
            this.connectionParameters = parameters;
            return resolve(true);
        })
    }

    /* Get the Azure IoT Hub connection parameters */
    public getConnectionParameters():AzureConnectionParameters|null{
        return this.connectionParameters;
    }

    /* Connect to the Azure IoT Hub using the connection settings */
    public async connect():Promise<string|boolean>{
        return new Promise<string|boolean>((resolve, reject)=>{
            // Make sure the connection parameters are set before we continue
            if( !this.connectionParameters ) return reject('Connection parameters not set');

            try{
                // Create the client
                switch(this.connectionParameters.authenticationType){
                    // With X.509 certificates authentication
                    case 'x509':    // Check the required X.509 parameters
                                    if( this.connectionParameters.authenticationType === 'x509' && ( typeof(this.connectionParameters.certificate) !== 'string') || typeof(this.connectionParameters.privateKey) !== 'string')
                                    return reject('X.509 authentication parameters incomplete');
                                    // Create the Azure IoT Hub client
                                    this.client = Client.fromConnectionString(  'HostName='+this.connectionParameters.hostName+
                                                                                ';DeviceId='+this.connectionParameters.deviceId+
                                                                                ';x509=true'
                                                                                , Mqtt);
                                    // Set the X.509 parameters
                                    this.client.setOptions({
                                        cert: this.connectionParameters.certificate,
                                        key: this.connectionParameters.privateKey
                                    });
                                    break;
                    // With Shared Key authentication
                    case 'sas':     // Check the required Shared Key parameters
                                    if( this.connectionParameters.authenticationType === 'sas' && typeof(this.connectionParameters.sharedAccessKey) !== 'string' )
                                    return reject('sas authentication parameters incomplete');
                                    // Create the Azure IoT Hub client
                                    this.client = Client.fromConnectionString('HostName='+this.connectionParameters.hostName+
                                                                              ';DeviceId='+this.connectionParameters.deviceId+
                                                                              ';SharedAccessKey='+this.connectionParameters.sharedAccessKey
                                                                              , Mqtt);
                                    break;

                    default:        return reject('Invalid authentication type in connection parameters');
                                    break;
                }

                // Register the event listeners
                this.client.on('connect', ()=>this.clientConnectHandler());
                this.client.on('disconnect', ()=>this.clientDisconnectHandler());
                this.client.on('error', (error:any)=>this.clientErrorHandler(error));
                this.client.on('message', (message:any)=>this.clientMessageHandler(message));

                // Open the Azure IoT Hub connection
                this.client.open();

                // If we got here, everything went fine
                return resolve(true);
            } catch(err){
                return reject(err);
            }
        });
    }

    /* Azure IoT client event handlers */
    private clientConnectHandler(){
        this.clientStatus.connected = true;
        this.emit( 'connected' );
        this.emit( 'status', this.clientStatus );
    }

    private clientDisconnectHandler(){
        // Emit the disconnected status
        this.clientStatus.connected = false;
        this.emit( 'disconnected' );
        this.emit( 'status', this.clientStatus );

        // Attempt to reconnect
        try{
            this.client.open();
        } catch(err){
            // Todo: do something with the error state
        }
    }

    private clientErrorHandler( error:any ){
        this.emit( 'error', error );
    }

    private clientMessageHandler( message:any ){
        this.emit( 'message', message );
    }
}