/*
 *  Azure IoT Client
 *
 *  The Azure IoT Client class serves as a comprehensive interface for managing device operations within the Azure IoT ecosystem.
 *  It encapsulates functionalities for device provisioning from Azure Device Provisioning Service (DPS), establishing secure
 *  connections to Azure IoT Hub, and facilitating bidirectional communication by sending and receiving messages, and providing
 *  invokable cloud-to-device direct methods.
 * 
 *  Copyright 2024 Sanne 'SpuQ' Santens
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
import { ProvisioningDeviceClient } from "azure-iot-provisioning-device";
import { SymmetricKeySecurityClient } from "azure-iot-security-symmetric-key";
import { EventEmitter } from "events";
import * as crypto from 'crypto';
import { X509Security } from "azure-iot-security-x509";

/* Types for Azure IoT Hub */
export type AzureConnectionParameters = {
    hostName: string;                       // Name of the host to connect to (e.g. myIoTHub.azure-devices.net)
    deviceId: string;                       // The unique ID of this device (e.g. Edge_Gateway_01)
    authenticationType: string;             // The authentication type (e.g. 'sas', 'x509')
    sharedAccessKey?: string;               // For Symmetric Key authentication
    certificate?: string;                   // For X.509 authentication
    privateKey?: string;                    // for X.509 authentication
}

export type AzureClientStatus = {
    connecting?:boolean;                    // Azure IoT Hub connecting activity
    connected?: boolean;                    // Azure IoT Hub connection status
    provisioning?: boolean;                 // Azure DPS provisioning activity
    provisioned?: boolean;                  // Azure DPS provisioning status
}

export type AzureMessage = {
    data: string;                           // The data should be a buffer?
    properties?: AzureMessageProperty[];    // key/value pair properties
}

export type AzureMessageProperty = {
    key: string;
    value: string;
}

export type AzureDirectMethod = {
    name: string;                           // The registration name of the method
    function: Function;                     // The function that is called when the method is invoked
}

/* Types for Azure Device Provisioning Service */
export type AzureDPSParameters = {
    hostName: string;                       // The hostname of the DPS (e.g. global.azure-devices-provisioning.net)
    idScope: string;                        // DPS instance identifier
    registrationId: string;                 // Unique identifier of this device to register with the DPS
    authenticationType: string;             // Type of authentication: Symmetric Key (sas), X.509 Certificate (x509) or Trusted Platform (tpm)
    individual?: boolean;                   // Individual or group authentication
    registrationKey?: string;               // For Symmetric Key authentication
    certificate?: string;                   // For X.509 authentication
    privateKey?: string;                    // For X.509 authentication
}

export class AzureClient extends EventEmitter {
    private connectionParameters:AzureConnectionParameters|null = null;                 // Azure IoT Hub connection parameters
    private provisioningParameters:AzureDPSParameters|null = null;                      // Azure Device Provisioning Service for IoT Hub parameters
    private clientStatus:AzureClientStatus = { connected: false, provisioning:false };  // Azure IoT Hub connection status
    private client:any|null = null;                                                     // The Azure IoT Hub client object
    private directMethods:AzureDirectMethod[] = [];                                     // Direct Methods

    constructor(){
        super();
    }

    public getClientStatus(){
        return this.clientStatus;
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

    /* Disconnect the Azure IoT Hub client */
    private disconnect(){
        if(this.client ){
            // Close the connection
            this.client.close();
            // Remove all the registered event listeners
            this.client.removeAllListeners();
            // Annihilate the client
            this.client = null;
        }
    }

    /* Connect to the Azure IoT Hub using the connection settings */
    public async connect():Promise<string|boolean>{
        return new Promise<string|boolean>((resolve, reject)=>{
            this.clientStatus.connecting = true;
            this.emit('connecting');

            // Disconnect the client first
            this.disconnect();

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
                    // With Symmetric Key authentication
                    case 'sas':     // Check the required Symmetric Key parameters
                                    if( this.connectionParameters.authenticationType === 'sas' && typeof(this.connectionParameters.sharedAccessKey) !== 'string' )
                                    return reject('sas authentication parameters incomplete');
                                    // Create the Azure IoT Hub client
                                    this.client = Client.fromConnectionString('HostName='+this.connectionParameters.hostName+
                                                                              ';DeviceId='+this.connectionParameters.deviceId+
                                                                              ';SharedAccessKey='+this.connectionParameters.sharedAccessKey
                                                                              , Mqtt);
                                    break;

                    // With Trusted Platform Module
                    case 'tpm':     return reject('Connecting with Trusted Platform Module not implemented.');
                                    break;

                    // None of the above, not supported
                    default:        return reject('Invalid authentication type in connection parameters');
                                    break;
                }

                // Register the event listeners
                this.client.on('connect', ()=>this.clientConnectHandler());
                this.client.on('disconnect', ()=>this.clientDisconnectHandler());
                this.client.on('error', (error:any)=>this.clientErrorHandler(error));
                this.client.on('message', (message:any)=>this.clientMessageHandler(message));

                // Subscribe direct methods list
                this.directMethods.forEach( (directMethod:AzureDirectMethod)=>{
                    this.client.onDeviceMethod( directMethod.name, directMethod.function );
                });

                // Open the Azure IoT Hub connection
                this.client.open();
                this.clientStatus.connecting = false;
                // If we got here, everything went fine
                return resolve(true);
            } catch(err){
                this.clientStatus.connecting = false;
                // Retry connecting in 2 seconds ...
                setTimeout(()=>{this.connect()},2000);
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
        try{
            setTimeout(()=>{this.client.open()},2000);
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
     *  Direct Methods
     */
    public registerDirectMethod( name:string, method:Function ){
        this.directMethods.push( {name:name, function:method} );
    }

    /*
     *  Device State management
     */

    /* Update the (reported) device state for a specific property */
    public updateState( key:string, value:string ):Promise<string|boolean>{
        return new Promise<string|boolean>(async (resolve, reject)=>{
            // If no client is initialized, don't even bother
            if( !this.client ) return reject('No Azure IoT Hub Client initialized');

            try{
                // Get the Device Twin
                const twin = await this.client.getTwin();
                // Update the state in the Device Twin
                const state = JSON.parse('"{"'+key+'":"'+value+'"}');
                twin.properties.reported.update( state );
            } catch( err ){
                return reject(err);
            }
        });
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
            return reject('Device provisioning with sas authentication requires a registration key');
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
            this.clientStatus.provisioned = false;
            this.emit('status', this.clientStatus );
            this.emit('provisioning');

            // Make sure the provisioning parameters are set before we continue
            if( !this.provisioningParameters ){
                this.clientStatus.provisioning = false;
                this.emit('error', 'Provisioning failed: no provisioning parameters');
                return reject('Provisioning parameters not set');
            }

            // Make a new Azure IoT Client Connection Parameters object
            let connectionParameters:AzureConnectionParameters = {
                hostName: '',
                deviceId: '',
                authenticationType:''
            };

            try{
                switch( this.provisioningParameters.authenticationType ){

                    /* X.509 Certificate */
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

                    /* Trusted Platform Module */
                    case 'tpm':     return reject('Provisioning with Trusted Platform Module not implemented.');
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
                            // Update the status
                            this.clientStatus.provisioned = true;
                            resolve(true);
                        })
                        .catch((err)=>{
                            this.clientStatus.provisioning = false;
                            this.clientStatus.provisioned = false;
                            this.emit('error', 'Failed to update Connection parameters from Provisioning Service');
                            return reject(err);
                        });
                });

            } catch( err ){
                this.emit('error', 'Failed to provision: '+err);
                this.clientStatus.provisioning = false;
                // Retry provisioning in 2 seconds...
                setTimeout(()=>{this.provision()},2000);
                return reject( err );
            }
        });
    }
}