/*
 * AWS IoT Core client for Edgeberry
 * - Purpose: MTLS MQTT client with stable reconnect, Thing Shadow (named: edgeberry-device),
 *   Direct Methods (RPC over MQTT), and Fleet Provisioning (by claim).
 * - Events: 'connecting' | 'connected' | 'disconnected' | 'status' | 'error' |
 *           'provisioning' | 'provisioned'
 * - Topics: Shadow: $aws/things/<id>/shadow/name/edgeberry-device/(get|update)[/accepted|rejected]
 *           Direct: edgeberry/things/<id>/methods/(post|response/<requestId>)
 *           App:    application/devices/<id>/messages/events
 *           FP:     $aws/certificates/create/json and
 *                   $aws/provisioning-templates/<tpl>/provision/json (± accepted|rejected)
 * - API: updateConnectionParameters(), connect(), sendMessage(), updateState(),
 *        registerDirectMethod(), updateProvisioningParameters(), provision()
 * - See usage in: src/main.ts | Docs: AWS IoT SDK v2 + samples
 */
import { mqtt, iot } from 'aws-iot-device-sdk-v2';
import { EventEmitter } from "events";
import { TextDecoder } from 'util';

// The AWS IoT Core provisioning template name
const provisioningTemplateName = "Edgeberry-provisioning-template"; 

/* Types for AWS IoT Core client */
export type AWSConnectionParameters = {
    hostName: string;                       // Name of the AWS endpoint to connect to (e.g. a11fkxltf4r89e-ats.iot.eu-north-1.amazonaws.com)
    deviceId: string;                       // The unique ID of this device (e.g. EdgeBerry_01)
    authenticationType: string;             // AWS IoT Core only has X.509 authentication
    certificate: string;                    // X.509 authentication certificate (<devicename>.cert.pem)
    privateKey: string;                     // X.509 authentication private key (<devicename>.private.key)
    rootCertificate?: string;               // X.509 authentication root certificate (root-CA.cert)
}

/* Types for AWS IoT Core client */
export type AWSProvisioningParameters = {
    hostName: string;                       // Name of the AWS endpoint to connect to (e.g. a11fkxltf4r89e-ats.iot.eu-north-1.amazonaws.com)
    clientId: string;                       // The unique ID (e.g. the serial number)
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
    properties?: MessageProperty[];         // key/value pair properties
}

export type MessageProperty = {
    key: string;
    value: string;
}

export type DirectMethod = {
    name: string;                           // The registration name of the method
    function: Function;                     // The function that is called when the method is invoked
}

class DirectMethodResponse {
    private statuscode:number = 200;        // HTTP Status code
    private callback:Function|null = null;  // Callback function
    private requestId:string = '';

    constructor( requestId:string, callback:Function ){
        this.callback = callback;
        this.requestId = requestId;
    }

    public send( payload:any ){
        if( typeof(this.callback) === 'function')
        if( this.statuscode === 200 ){
            this.callback( {status:this.statuscode, payload:payload, requestId:this.requestId} );
        }
        else{
            this.callback( { status:this.statuscode, message:payload.message, requestId:this.requestId} );
        }
    }

    public status( status:number ){
        this.statuscode = status;
        return this;                // by returning this, we can chain-call functions (e.g. res.status().send())
    }

}


export class AWSClient extends EventEmitter {
    private connectionParameters: AWSConnectionParameters|null = null;                    // AWS IoT Core connection parameters
    private provisioningParameters: AWSProvisioningParameters|null = null;                // AWS IoT Core Device Provisioning Service parameters
    private clientStatus:AWSClientStatus = { connected: false, provisioning:false };      // AWS IoT Core connection status
    private client:mqtt.MqttClientConnection|null = null;                                 // AWS IoT Core client object
    private directMethods:DirectMethod[] = [];                                            // Direct Methods (not natively supported by AWS IoT Core?)
    private reconnectAttempts = 0;                                                        // Reconnect attempt counter

    // MQTT topics
    private shadowTopicPrefix = '';     // Shadow topic prefix

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
            //this.disconnect();

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
                // Set keep alive to 240 seconds (more agressive connectivity checks - default is 1200 seconds)
                config_builder.with_keep_alive_seconds( 240 );
                const config = config_builder.build();

                // Create the MQTT client
                const mqttClient = new mqtt.MqttClient();
                // Create the MQTT connection
                this.client = mqttClient.new_connection( config );
                
                // Register the event listeners
                this.client.on('connect', ()=>this.clientConnectHandler());
                this.client.on('disconnect', ()=>this.clientDisconnectHandler());
                this.client.on('error', (error:any)=>this.clientErrorHandler(error));

                // Open the AWS IoT Core connection
                await this.client.connect();

                // After successful connection, set up topics and subscriptions
                // Thing Shadow
                // The named shadow for EdgeBerry devices is 'edgeberry-device'
                this.shadowTopicPrefix = '$aws/things/'+this.connectionParameters.deviceId+'/shadow/name/edgeberry-device';

                // Shadow update topics
                await this.client.subscribe(
                    this.shadowTopicPrefix+'/update/accepted',
                    mqtt.QoS.AtMostOnce,
                    (topic, payload)=>this.updateShadowResponseHandler(topic, payload)
                );
                await this.client.subscribe(
                    this.shadowTopicPrefix+'/update/rejected',
                    mqtt.QoS.AtMostOnce,
                    (topic, payload)=>this.updateShadowResponseHandler(topic, payload)
                );
                // Shadow get topics
                await this.client.subscribe(
                    this.shadowTopicPrefix+'/get/accepted',
                    mqtt.QoS.AtMostOnce,
                    (topic, payload)=>this.getShadowResponseHandler(topic, payload)
                );
                await this.client.subscribe(
                    this.shadowTopicPrefix+'/get/rejected',
                    mqtt.QoS.AtMostOnce,
                    (topic, payload)=>this.getShadowResponseHandler(topic, payload)
                );

                // Direct Methods
                // Direct method invocations (Cloud-to-Device) are posted to the /methods/post topic
                await this.client.subscribe(
                    'edgeberry/things/'+this.connectionParameters.deviceId+'/methods/post',
                    mqtt.QoS.AtMostOnce,
                    (topic, payload)=>this.handleDirectMethod(topic, payload)
                );

                // Application (placeholder)
                await this.client.subscribe(
                    'application/devices/'+this.connectionParameters.deviceId+'/methods/post',
                    mqtt.QoS.AtMostOnce,
                    (_topic, _payload)=>{}
                );

                this.clientStatus.connecting = false;
                this.reconnectAttempts = 0; // reset backoff on success
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
        const maxDelayMs = 30000; // cap at 30s
        const baseDelayMs = 1000;
        const jitterMs = 250;
        const attempt = Math.min(this.reconnectAttempts + 1, 10);
        const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs) + Math.floor(Math.random()*jitterMs);
        this.reconnectAttempts = attempt;
        setTimeout(()=>{
            this.connect().catch(()=>{/* swallow, next disconnect/error schedules again */});
        }, delay);
    }

    /* Send message */
    public sendMessage( message:Message ):Promise<string|boolean>{
        return new Promise(async(resolve, reject)=>{
            // Don't bother sending a message if there's no client
            if( !this.client ) return reject('No client');
            // Create a new message object
            let msg:any = {};
            // Encode the (JSON) message to UTF-8
            //msg.data = encoder.encode(message.data);
            //msg.data = Buffer.from(message.data, 'utf8');
            msg.data = message.data;
            // Add the properties to the message
            if( message.properties && message.properties.length > 0){
                message.properties.forEach((property)=>{
                    msg[property.key] = property.value;
                });
            }
            // Publish the UTF-8 encoded message to topic 'devices/<deviceId>/messages/events'
            try{
                await this.client.publish(
                    'application/devices/'+this.connectionParameters?.deviceId+'/messages/events',
                    JSON.stringify(msg),
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
        // schedule reconnect
        this.reconnect();
    }

    private clientErrorHandler( error:any ){
        this.emit( 'error', error );
        // Reconnect after error
        this.reconnect();
    }

    /*
     *  Direct Methods
     *  Cloud-To-Device messaging. Invoke direct methods from the cloud on this device,
     *  and receive a reply.
     * 
     *  https://docs.aws.amazon.com/wellarchitected/latest/iot-lens/device-commands.html
     *  
     */

    // Handler for direct method invocations
    private async handleDirectMethod(topic:string, payload:ArrayBuffer ){
        try{
            // Decode UTF-8 payload
            const request = JSON.parse((new TextDecoder().decode(payload)).toString());
            //console.log(request);
            // Find the registered method with this method name
            const directMethod = this.directMethods.find(obj => obj.name === request?.name );
            // If the method is not found, return 'not found' to caller
            if(!directMethod) return await this.respondToDirectMethod( { status:404, message:'Method not found', requestId: request.requestId });
            // Invoke the direct method
            directMethod.function( request, new DirectMethodResponse( request.requestId, ( response:any )=>{
                // Send a respons to the invoker
                this.respondToDirectMethod( response );
            }))
        } catch(err){
            return await this.respondToDirectMethod( {httpStatusCode:500, message:"That didn't work"});
        }
    }

    // Send response to a direct method
    private async respondToDirectMethod( response:any ){
        // Publish the response
        if( !this.client || !this.connectionParameters?.deviceId ) return;
        await this.client.publish(
            'edgeberry/things/'+this.connectionParameters.deviceId+'/methods/response/'+response.requestId,
            JSON.stringify(response),
            mqtt.QoS.AtMostOnce,
            true
        );
    }

    // Register direct methods
    public registerDirectMethod( name:string, method:Function ){
        this.directMethods.push( {name:name, function:method} );
    }

    /*
     *  Device State management (Thing Shadow)
     *  Every shadow has a reserved MQTT topic that supports the 'get', 'update' and 'delete' actions
     *  on the shadow. Devices should only write the 'reported' property of the shadow.
     * 
     *  https://docs.aws.amazon.com/iot/latest/apireference/API_iotdata_GetThingShadow.html
     */

    /* Update the (reported) device state for a specific property */
    public updateState( key:string, value:string|number|boolean|object ):Promise<string|boolean>{
        return new Promise<string|boolean>(async (resolve, reject)=>{
            if( !this.client || !this.clientStatus.connected ) return reject('No connection');            
            // create the state object
            let reported:any = {};
            reported[key] = value;
            const state = { state:{ reported:reported } };
            try{
                await this.client.publish(
                    this.shadowTopicPrefix+'/update',
                    JSON.stringify(state),
                    mqtt.QoS.AtMostOnce
                );
                return resolve('success');
            }
            catch(err){
                return reject(err);
            }
        });
    }

    private updateShadowResponseHandler( topic:string, payload:ArrayBuffer ){
        try{
            //console.log(topic);
            // Decode UTF-8 payload
            const decoder = new TextDecoder();
            const request = JSON.parse(decoder.decode(payload));
            //console.log(request)
        } catch(err){
            this.emit('error', err);
        }
    }

    private async getShadow(){
        if( !this.client || !this.clientStatus.connected ) return;
        console.log( 'Requesting shadow: '+this.shadowTopicPrefix+'/get');
        await this.client.publish( this.shadowTopicPrefix+'/get', '', mqtt.QoS.AtMostOnce );
    }

    private getShadowResponseHandler( topic:string, payload:ArrayBuffer ){
        try{
            //console.log(topic);
            // Decode UTF-8 payload
            const decoder = new TextDecoder();
            const request = JSON.parse(decoder.decode(payload));
            //console.log(request)
        } catch(err){
            this.emit('error', err);
        }
    }

    /*
     *  Device Provisioning Service
     *  Automated onboarding of devices using Just In Time Provisionig (JITP) by 'fleet provisioning (by claim)'. For registration, a private
     *  key and certificate must be provided by the device maker (manufacturer).
     *  
     *  https://aws.amazon.com/blogs/iot/how-to-automate-onboarding-of-iot-devices-to-aws-iot-core-at-scale-with-fleet-provisioning/ 
     *  https://docs.aws.amazon.com/iot/latest/developerguide/jit-provisioning.html#jit-provisioning-overview
     *  https://docs.aws.amazon.com/iot/latest/developerguide/fleet-provision-api.html
     * 
     */

    /* Update the parameters for the Device Provisioning Service */
    public updateProvisioningParameters( parameters:any ):Promise<string|boolean>{
        return new Promise<string|boolean>((resolve, reject)=>{
            this.provisioningParameters = parameters;
            //console.log(this.provisioningParameters);
            return resolve(true);
        });
    }

    /* Get the parameters for the Device Provisioning Service */
    public getProvisioningParameters():AWSProvisioningParameters|null{
        return this.provisioningParameters;
    }

    /* Provison the AWS IoT Core client using the Device Provisioning Service */
    public provision():Promise<string|boolean>{
        return new Promise<string|boolean>(async(resolve, reject)=>{
            this.emit('provisioning');
            // Connect to the Provisioning service using the provisioning parameters
            
            if( !this.provisioningParameters ) return reject('Provisioning parameters not set');

            try{
                // Check the required X.509 parameters
                if( typeof(this.provisioningParameters.certificate) !== 'string' || typeof(this.provisioningParameters.privateKey) !== 'string' )
                return reject('X.509 authentication parameters incomplete');
                // Create the AWS IoT Core client
                let config_builder = iot.AwsIotMqttConnectionConfigBuilder.new_mtls_builder(this.provisioningParameters.certificate, this.provisioningParameters.privateKey);
                // If a root certificate is set, use the root certificate
                if ( typeof(this.provisioningParameters.rootCertificate) === 'string' && this.provisioningParameters.rootCertificate !== '' ) {
                    config_builder.with_certificate_authority( this.provisioningParameters.rootCertificate );
                }
                // By setting 'clean session' to 'false', the MQTT client will retain its session state when it
                // reconnects to the broker, enabling it to resume previous subscriptions and receive queued messages.
                config_builder.with_clean_session(false);
                // Set the MQTT Client ID
                config_builder.with_client_id( 'Edgeberry-ID'+this.provisioningParameters.clientId );
                // Set the AWS endpoint (host)
                config_builder.with_endpoint( this.provisioningParameters.hostName );
                const config = config_builder.build();
                // Create the MQTT client
                const mqttClient = new mqtt.MqttClient();
                // Create the MQTT connection
                const provisioningClient = mqttClient.new_connection( config );

                var certificate = '';
                var privateKey = '';
                var rootCa = '';

                // Open the AWS IoT Core connection for provisioning
                await provisioningClient.connect();

                // Subscribe to the device provisioning response
                provisioningClient.subscribe('$aws/certificates/create/json/accepted', mqtt.QoS.AtLeastOnce, async(topic, payload)=>{
                    const response = JSON.parse(new TextDecoder().decode(payload));
                    // The payload contains the new certificate
                    certificate = response.certificatePem;
                    privateKey = response.privateKey;
                    // Some templates include root CA as 'rootCa' in response
                    rootCa = response.rootCa ? response.rootCa : '';
                    // Create the registration
                    // -> The parameters are parameters passed to the provisioning template!
                    const parameters = {
                        certificateOwnershipToken: response.certificateOwnershipToken,
                        parameters:{
                            SerialNumber: this.provisioningParameters?.clientId
                        }
                    }
                    // Publish registration request
                    provisioningClient.publish(
                        '$aws/provisioning-templates/'+provisioningTemplateName+'/provision/json',
                        JSON.stringify(parameters),
                        mqtt.QoS.AtMostOnce
                    );
                });

                // Provisioning: subscribe to the certificate creation
                // rejection topic
                provisioningClient.subscribe('$aws/certificates/create/json/rejected', mqtt.QoS.AtLeastOnce, (topic, payload)=>{
                    console.error("Provisioning: Certificate creation rejected: "+new TextDecoder().decode(payload));
                    return reject(new TextDecoder().decode(payload));
                });

                // Registration: subscribe to the registration accepted topic
                provisioningClient.subscribe('$aws/provisioning-templates/'+provisioningTemplateName+'/provision/json/accepted', mqtt.QoS.AtLeastOnce, (topic, payload)=>{
                    const response = JSON.parse(new TextDecoder().decode(payload));
                    //console.log(response);

                    const connectionParameters = {
                        hostName: this.provisioningParameters?.hostName || '',
                        deviceId: (response?.thingName || this.provisioningParameters?.clientId || ''),
                        authenticationType: 'x509',
                        certificate: certificate,
                        privateKey: privateKey,
                        // Align with consumer in main.ts which expects 'rootCertificate'
                        rootCertificate: rootCa
                    }
                    // Disconnect the provisioning client
                    provisioningClient.disconnect();
                    // Emit the connection parameters
                    this.emit('provisioned', connectionParameters);
                    return resolve(true);
                });
                provisioningClient.subscribe('$aws/provisioning-templates/'+provisioningTemplateName+'/provision/json/rejected', mqtt.QoS.AtLeastOnce, (topic, payload)=>{
                    //console.log("Device provisioning rejected")
                    return reject(new TextDecoder().decode(payload));
                });

                // When the provisioning client connects, we request
                // a certificate by publishing to the create certificate topic
                provisioningClient.on('connect', ()=>{
                    //console.log('connected to provisioning service')
                    provisioningClient.publish(
                        '$aws/certificates/create/json',
                        JSON.stringify({ parameters: { serialNumber: this.provisioningParameters?.clientId || 'unknown' } }),
                        mqtt.QoS.AtMostOnce
                    );
                });

                //provisioningClient.on('disconnect', ()=>{console.log("ProvisioningClient disconnected")});
                provisioningClient.on('error', (error:any)=>{return reject(error)});

                // Do not resolve here; resolution happens in accepted/rejected handlers above
            } catch(err){
                this.clientStatus.provisioning = false;
                this.clientStatus.provisioned = false;
                return reject(err);
            }
        });
    }
}