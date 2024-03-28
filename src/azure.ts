/*
 *  Azure
 *  We're using Azure for our first cloud connection.
 * 
 *  Copyright 2024  Sanne 'SpuQ' Santens
 * 
 *  Azure SDK examples:
 *      https://github.com/Azure/azure-iot-sdk-node/tree/main/device/samples/typescript
 *      https://github.com/Azure/azure-iot-sdk-node/tree/main/provisioning/device/samples
 * 
 *  Microsoft IoT Hub documentation:
 *      https://learn.microsoft.com/en-us/azure/iot-hub/
 */

import { Client, Message } from "azure-iot-device";
import { Mqtt } from "azure-iot-device-mqtt";
import { Mqtt as DPSMqtt } from "azure-iot-provisioning-device-mqtt";
import { ProvisioningDeviceClient, RegistrationResult } from "azure-iot-provisioning-device";
import { SymmetricKeySecurityClient } from "azure-iot-security-symmetric-key";
import { EventEmitter } from "events";
import * as crypto from 'crypto';
import { X509Security } from "azure-iot-security-x509";

/* Types for Azure IoT Hub */
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

export type AzureMessage = {
    data: string;
    properties?: AzureMessageProperty[];
}

export type AzureMessageProperty = {
    key: string;
    value: string;
}

/* Types for Azure Device Provisioning Service */
export type AzureDPSParameters = {
    hostName: string;
    idScope: string;
    registrationId: string;
    authenticationType: string;
    individual?: boolean;
    registrationKey?: string;
    certificate?: string;
    privateKey?: string;
}

export class AzureClient extends EventEmitter {
    // Azure IoT Hub connection parameters
    private connectionParameters:AzureConnectionParameters|null = null;
    // Azure Device Provisioning Service for IoT Hub parameters
    private provisioningParameters:AzureDPSParameters|null = null;
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
            if( parameters.authenticationType === 'x509' && (typeof(parameters.certificate ) !== 'string' || typeof(parameters.privateKey) !== 'string'))
            return reject('X.509 authentication requires a certificate and private key');
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
            this.emit('connecting');

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

    /* Send message */
    public sendMessage( message:AzureMessage ):Promise<string|boolean>{
        return new Promise((resolve, reject)=>{
            // Reject the message if no client is initialized
            if( !this.client ) return reject('No Azure IoT Hub client');

            // Create the new message
            let newMessage = new Message( message.data );
            // Add the properties, if any
            if( message.properties ){
                message.properties.forEach( (property:AzureMessageProperty) =>{
                    newMessage.properties.add( property.key, property.value );
                });
            }

            // Send the message
            try{
                this.client.sendEvent( newMessage );
                resolve( true );
            } catch( err ){
                reject( err );
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

    /*
     *  Device Provisioning Service
     *  for Azure IoT Hub
     */

    /* Update the parameters for the Device Provisioning Service */
    public updateProvisioningParameters( parameters:AzureDPSParameters ):Promise<string|boolean>{
        return new Promise<string|boolean>((resolve, reject)=>{
            // Check if the parameters are correct
            if( parameters.authenticationType === 'sas' && typeof(parameters.registrationKey) !== 'string' )
            return reject('Device provisioning with sas authentication requires a shared access key');
            if( parameters.authenticationType === 'x509' && (typeof(parameters.certificate ) !== 'string' || typeof(parameters.privateKey) !== 'string'))
            return reject('Device provisioning with X.509 authentication requires a certificate and private key');
            // Set the DPS parameters
            this.provisioningParameters = parameters;
            return resolve(true);
        });
    }

    /* Get the parameters for the Device Provisioning Service */
    public getProvisioningParameters():AzureDPSParameters|null{
        return this.provisioningParameters;
    }

    /* Provison the Azure IoT client using the Device Provisioning Service */
    public provision():Promise<string|boolean>{
        return new Promise<string|boolean>((resolve, reject)=>{
            // Emit the provisioning status
            this.clientStatus.provisioning = true;
            this.emit('status', this.clientStatus );
            this.emit('provisioning');

            // Make a new Azure IoT Client Connection Parameters object
            let connectionParameters:AzureConnectionParameters = {
                hostName: '',
                deviceId: '',
                authenticationType:''
            };

            // Make sure the provisioning parameters are set before we continue
            if( !this.provisioningParameters ) return reject('Provisioning parameters not set');

            try{
                switch( this.provisioningParameters.authenticationType ){
                    case 'x509':    if( typeof(this.provisioningParameters.certificate) !== 'string' || typeof(this.provisioningParameters.privateKey) !== 'string')
                                    return reject('Provisioning with X.509 authentication requires a certificate and a private key');
                                    // The authentication method for the connection will also be X.509 certificates
                                    connectionParameters.authenticationType = 'x509';
                                    // TODO: individual or group?
                                    connectionParameters.privateKey = this.provisioningParameters.privateKey;
                                    connectionParameters.certificate = this.provisioningParameters.certificate;
                                    // Create the security client for X.509 authentication
                                    var provisioningSecurityClient:any = new X509Security( this.provisioningParameters.registrationId,{
                                                                                                                                    cert: this.provisioningParameters.certificate,
                                                                                                                                    key: this.provisioningParameters.privateKey
                                                                                                                                });
                                    break;

                    /* Symmetric Key */
                    case 'sas':     if( typeof(this.provisioningParameters.registrationKey) !== 'string' ) return reject('Provisioning with symmetric key authentication requires a registration key');
                                    // The authentication method for the connection will also be symmetric keys
                                    connectionParameters.authenticationType = 'sas';
                                    // If it's a group key, create individual key, otherwise just copy the shared access key
                                    connectionParameters.sharedAccessKey = this.provisioningParameters.individual?connectionParameters.sharedAccessKey:crypto.createHmac('SHA256', Buffer.from(this.provisioningParameters.registrationKey, 'base64'))
                                                                                                                                                                .update( this.provisioningParameters.registrationId, 'utf8')
                                                                                                                                                                .digest( 'base64');
                                    // Check whether the Shared Access Key is present
                                    if(!connectionParameters.sharedAccessKey) return reject('Something went wrong with the shared access key');
                                    // Create the security client for Symmetric Key authentication
                                    var provisioningSecurityClient:any = new SymmetricKeySecurityClient( this.provisioningParameters.registrationId, connectionParameters.sharedAccessKey );
                                    break;

                    /* No sensable value */
                    default:        return reject('Invalid authentication type '+this.provisioningParameters.authenticationType+' for Device Provisioning Service');
                                    break;
                }
                // Create the registration client
                let registrationClient = ProvisioningDeviceClient.create( this.provisioningParameters.hostName,
                                                                          this.provisioningParameters.idScope,
                                                                          new DPSMqtt(),
                                                                          provisioningSecurityClient
                                                                        );

                // Register the client with the Device Provisioning Service
                registrationClient.register((error, result)=>{
                    if( error ) return reject( error );
                    if( !result?.assignedHub || !result?.deviceId ) return reject('No assigned hub or device ID in provisioning service result');
                    connectionParameters.hostName = result.assignedHub;
                    connectionParameters.deviceId = result.deviceId;

                    // Update the Azure IoT Hub connection parameters
                    this.updateConnectionParameters( connectionParameters )
                        .then(()=>{
                            // End the provisioning operation. We're done.
                            this.clientStatus.provisioning = false;
                            this.emit('status', this.clientStatus );
                            this.emit('provisioned');
                            resolve(true);
                        })
                        .catch((err)=>{
                            this.emit('error', 'Failed to update Connection parameters from Provisioning Service')
                            return reject(err);
                        });
                });

            } catch( err ){
                this.emit('error', 'Failed to provision: '+err);
                return reject( err );
            }
        });
    }
}