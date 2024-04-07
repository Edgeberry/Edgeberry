/*
 *  AWS IoT Core client
 *  
 *  
 *  AWS IoT Core SDK examples:
 *      https://docs.aws.amazon.com/iot/latest/developerguide/iot-sdks.html
 *      https://github.com/aws/aws-iot-device-sdk-js-v2
 *      https://github.com/aws/aws-iot-device-sdk-js-v2/blob/main/samples/node/
 *  
 *  AWS IoT Core documentation:
 *      https://docs.aws.amazon.com/iot/latest/developerguide/what-is-aws-iot.html
 */
import { mqtt } from 'aws-iot-device-sdk-v2';
import { iot } from 'aws-iot-device-sdk-v2';
import { EventEmitter } from "events";
import { TextDecoder, TextEncoder } from 'util';

/* Types for AWS IoT Core client */
export type AWSConnectionParameters = {
    hostName: string;                       // Name of the AWS endpoint to connect to (e.g. a11fkxltf4r89e-ats.iot.eu-north-1.amazonaws.com)
    deviceId: string;                       // The unique ID of this device (e.g. EdgeBerry_01)
    authenticationType: string;             // AWS IoT Core only has X.509 authentication
    certificate: string;                    // X.509 authentication certificate (<devicename>.cert.pem)
    privateKey: string;                     // X.509 authentication private key (<devicename>.private.key)
    rootCertificate?: string;               // X.509 authentication root certificate (root-CA.cert)
}

export type AWSClientStatus = {
    connecting?:boolean;                    // AWS IoT Core connecting activity
    connected?: boolean;                    // AWS IoT Core connection status
    provisioning?: boolean;                 // AWS IoT Core provisioning activity
    provisioned?: boolean;                  // AWS IoT Core provisioning status
}

export type Message = {
    data: string;                           // The data should be a buffer?
    properties?: MessageProperty[];    // key/value pair properties
}

export type MessageProperty = {
    key: string;
    value: string;
}


export type AWSDirectMethodResponse = {
    status:number                       // AWS IoT Core connecting activity
    data?: any;                         // AWS IoT Core connection status
    error?: any;
    requestId: string;                          // ID of the request to which this is a response
}

export type DirectMethod = {
    name: string;                           // The registration name of the method
    function: Function;                     // The function that is called when the method is invoked
}

export class AWSClient extends EventEmitter {
    private connectionParameters: AWSConnectionParameters|null = null;                    // AWS IoT Core connection parameters
    //private provisioningParameters: AWSDPSParameters|null = null;                       // AWS IoT Core Device Provisioning Service parameters
    private clientStatus:AWSClientStatus = { connected: false, provisioning:false };      // AWS IoT Core connection status
    private client:mqtt.MqttClientConnection|null = null;                                 // AWS IoT Core client object
    private directMethods:DirectMethod[] = [];                                            // Direct Methods (not natively supported by AWS IoT Core?)

    constructor(){
        super();
    }

    /* Get the current status of the AWS IoT Core client */
    public getClientStatus(){
        return this.clientStatus;
    }

    /* Update the AWS IoT Core connection parameters */
    public async updateConnectionParameters( parameters:AWSConnectionParameters ):Promise<string|boolean>{
        return new Promise<string|boolean>((resolve, reject)=>{
            // Check if the parameters are correct
            if( (typeof(parameters.certificate ) !== 'string' || typeof(parameters.privateKey) !== 'string'))
            return reject('X.509 authentication requires a certificate and private key');
            // Set the connection parameters
            this.connectionParameters = parameters;
            return resolve(true);
        })
    }

    /* Get the AWS IoT Core connection parameters */
    public getConnectionParameters():AWSConnectionParameters|null{
        return this.connectionParameters;
    }

    /* Disconnect the AWS Iot Core client */
    private async disconnect(){
        if( this.client !== null ){
            // Close the connection
            try{
                await this.client.disconnect();
                // Remove all the registered event listeners
                this.client.removeAllListeners();
                // Annihilate the client
                this.client = null;
            } catch (err){}

            this.client = null;
        }
    }

    /* Connect to the AWS IoT Core using the connection settings */
    public connect():Promise<string|boolean>{
        return new Promise<string|boolean>(async(resolve, reject)=>{
            this.clientStatus.connecting = true;
            this.emit('connecting');

            // Disconnect the client first
            this.disconnect();

            // Make sure the connection parameters are set before we continue
            if( !this.connectionParameters ) return reject('Connection parameters not set');

            try{
                // Check the required X.509 parameters
                if( typeof(this.connectionParameters.certificate) !== 'string' || typeof(this.connectionParameters.privateKey) !== 'string' )
                return reject('X.509 authentication parameters incomplete');
                // Create the AWS IoT Core client
                let config_builder = iot.AwsIotMqttConnectionConfigBuilder.new_mtls_builder(this.connectionParameters.certificate, this.connectionParameters.privateKey);
                // If a root certificate is set, use the root certificate
                if ( typeof(this.connectionParameters.rootCertificate) === 'string' && this.connectionParameters.rootCertificate !== '' ) {
                    config_builder.with_certificate_authority( this.connectionParameters.rootCertificate );
                }
                // By setting 'clean session' to 'false', the MQTT client will retain its session state when it
                // reconnects to the broker, enabling it to resume previous subscriptions and receive queued messages.
                config_builder.with_clean_session(false);
                // Set the MQTT Client ID
                config_builder.with_client_id( this.connectionParameters.deviceId );
                // Set the AWS endpoint (host)
                config_builder.with_endpoint( this.connectionParameters.hostName );
                const config = config_builder.build();

                // Create the MQTT client
                const mqttClient = new mqtt.MqttClient();
                // Create the MQTT connection
                this.client = mqttClient.new_connection( config );

                // Subscribe to the Direct Methods topic (/devices/<device ID>/methods/post)
                this.client.subscribe("/devices/"+this.connectionParameters.deviceId+"/methods/post", mqtt.QoS.AtMostOnce, this.directMethodHandler);

                // Register the event listeners
                this.client.on('connect', ()=>this.clientConnectHandler());
                this.client.on('disconnect', ()=>this.clientDisconnectHandler());
                this.client.on('error', (error:any)=>this.clientErrorHandler(error));

                // Open the AWS IoT Core connection
                await this.client.connect();
                this.clientStatus.connecting = false;
                // If we got here, everything went fine
                return resolve(true);
            } catch(err){
                this.clientStatus.connecting = false;
                // Retry connecting in 2 seconds ...
                setTimeout(()=>{this.reconnect()},5000);
                return reject(err);
            }
        });
    }

    private reconnect(){
            this.connect()
                .then(()=>{
                    console.log("success!")
                })
                .catch((err)=>{
                });
    }

    /* Send message */
    public sendMessage( message:Message ):Promise<string|boolean>{
        return new Promise(async(resolve, reject)=>{
            // Don't bother sending a message if there's no client
            if( !this.client ) return reject('No client');
            const encoder = new TextEncoder();
            // Create a new message object
            let msg:any = {};
            // Encode the (JSON) message to UTF-8
            msg.data = encoder.encode(message.data);
            // Add the properties to the message
            if( message.properties && message.properties.length > 0){
                message.properties.forEach((property)=>{
                    msg[property.key] = property.value;
                });
            }
            // Publish the UTF-8 encoded message to topic 'devices/<deviceId>/messages/events'
            try{
                const result = await this.client.publish(
                                    'devices/'+this.connectionParameters?.deviceId+'/messages/events',
                                    msg,
                                    mqtt.QoS.AtLeastOnce,
                                    false
                                );
                return resolve(true);
            } catch(err){
                return reject(err);
            }
        });
    }

    /* AWS IoT Core client event handlers */
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
        //setTimeout(()=>{this.reconnect()},2000);
    }

    private clientErrorHandler( error:any ){
        this.emit( 'error', error );
        // Reconnect after error
        //setTimeout(()=>{this.reconnect()},5000);
    }

    /*
     *  Direct Methods
     */
    public registerDirectMethod( name:string, method:Function ){
        //this.directMethods.push( {name:name, function:method} );
    }

    /* Looks up and calls the method for a direct method invokation */
    private directMethodHandler( topic:string, payload:ArrayBuffer ){
        let response:AWSDirectMethodResponse = {status:500, requestId:''}
        try{
            // Decode UTF-8 payload
            const decoder = new TextDecoder();
            const request = JSON.parse(decoder.decode(payload));
            console.log(request);

            // Check if the required parameters are included
            if( typeof(request?.methodName) !== 'string' ){
                //
            }

            // Find this method in the directMethod registry
            this.directMethods.forEach( (directMethod)=>{
                if(directMethod.name === request.methodName ){
                    // Call the function that belongs to this method
                    console.log("function found");
                }
            });

        } catch(err){
            this.emit('error', err);
        }

    }

    /*
     *  Device State management
     */

    /* Update the (reported) device state for a specific property */
    public updateState( key:string, value:string ):Promise<string|boolean>{
        return new Promise<string|boolean>(async (resolve, reject)=>{
            reject('Not implemented');
        });
    }

    /*
     *  Device Provisioning Service
     *  for Azure IoT Hub
     */

    /* Update the parameters for the Device Provisioning Service */
    public updateProvisioningParameters( parameters:any ):Promise<string|boolean>{
        return new Promise<string|boolean>((resolve, reject)=>{
            return resolve(true);
        });
    }

    /* Get the parameters for the Device Provisioning Service */
    public getProvisioningParameters():any|null{
        return {};
    }

    /* Provison the Azure IoT client using the Device Provisioning Service */
    public provision():Promise<string|boolean>{
        return new Promise<string|boolean>((resolve, reject)=>{
            reject('Not implemented');
        });
    }
}