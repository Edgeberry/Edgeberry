/*
 * Edgeberry Device Hub client for Edgeberry-device-software
 * - Purpose: MQTT client with stable reconnect and Device Twin integration
 * - Events: 'connecting' | 'connected' | 'disconnected' | 'status' | 'error' | 'twin' | 'twin-delta'
 * - Topics (Device-Hub):
 *    Get:      $devicehub/devices/<id>/twin/get
 *    Update:   $devicehub/devices/<id>/twin/update
 *    Accepted: $devicehub/devices/<id>/twin/update/accepted
 *    Delta:    $devicehub/devices/<id>/twin/update/delta
 *    Rejected: $devicehub/devices/<id>/twin/update/rejected
 *    Heartbeat: $devicehub/devices/<id>/heartbeat
 *    Provision Request: $devicehub/devices/<id>/provision/request
 *    Provision Accepted: $devicehub/devices/<id>/provision/accepted
 *    Provision Rejected: $devicehub/devices/<id>/provision/rejected
 * - API: updateConnectionParameters(), connect(), sendMessage(), updateState(), sendHeartbeat(), provision()
 */

import { connect, IClientOptions, MqttClient } from 'mqtt';
import { EventEmitter } from 'events';

/* Types for Device Hub client - matching AWS client interface */
export type HubConnectionParameters = {
  hostName: string;                 // MQTT broker host (e.g. mqtt.example.com)
  deviceId: string;                 // Unique device ID
  authenticationType: string;       // X.509 authentication (matching AWS client)
  certificate: string;              // X.509 client certificate (PEM)
  privateKey: string;               // X.509 private key (PEM)
  rootCertificate?: string;         // Optional root CA (PEM)
};

export type HubProvisioningParameters = {
  hostName: string;                 // MQTT broker host for provisioning
  clientId: string;                 // Client ID for provisioning (UUID)
  authenticationType: string;       // X.509 authentication
  certificate: string;              // Provisioning certificate (PEM)
  privateKey: string;               // Provisioning private key (PEM)
  rootCertificate?: string;         // Optional root CA (PEM)
};

export type HubClientStatus = {
  connecting?: boolean;
  connected?: boolean;
  provisioning?: boolean;
  provisioned?: boolean;
};

export type Message = {
  data: string;
  properties?: MessageProperty[];
};

export type MessageProperty = {
  key: string;
  value: string;
};

export type DirectMethod = {
  name: string;
  function: Function;
};

class DirectMethodResponse {
  private statuscode: number = 200;
  private callback: Function | null = null;
  private requestId: string = '';

  constructor(requestId: string, callback: Function) {
    this.callback = callback;
    this.requestId = requestId;
  }

  public send(payload: any) {
    if (typeof this.callback === 'function') {
      if (this.statuscode === 200) {
        this.callback({ status: this.statuscode, payload: payload, requestId: this.requestId });
      } else {
        this.callback({ status: this.statuscode, message: payload.message, requestId: this.requestId });
      }
    }
  }

  public status(status: number) {
    this.statuscode = status;
    return this;
  }
}

export class HubClient extends EventEmitter {
  private connectionParameters: HubConnectionParameters | null = null;
  private provisioningParameters: HubProvisioningParameters | null = null;
  private clientStatus: HubClientStatus = { connected: false, provisioning: false };
  private client: MqttClient | null = null;
  private reconnectAttempts = 0;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private directMethods: DirectMethod[] = [];

  constructor() {
    super();
  }

  /* Publish to an arbitrary MQTT topic (utility for tests/registry heartbeats) */
  public publish(topic: string, payload: any, qos: 0 | 1 | 2 = 1, retain = false): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.connectionParameters) return reject('No client');
      const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
      this.client.publish(topic, body, { qos, retain }, (err) => (err ? reject(err) : resolve(true)));
    });
  }

  public getClientStatus() {
    return this.clientStatus;
  }

  public async updateConnectionParameters(parameters: HubConnectionParameters): Promise<string | boolean> {
    return new Promise<string | boolean>((resolve, reject) => {
      // Check if the parameters are correct (matching AWS client validation)
      if (typeof parameters.certificate !== 'string' || typeof parameters.privateKey !== 'string') {
        return reject('X.509 authentication requires a certificate and private key');
      }
      // Set the connection parameters
      this.connectionParameters = parameters;
      return resolve(true);
    });
  }

  public getConnectionParameters(): HubConnectionParameters | null {
    return this.connectionParameters;
  }

  /* Update the parameters for the Device Provisioning Service */
  public updateProvisioningParameters(parameters: HubProvisioningParameters): Promise<string | boolean> {
    return new Promise<string | boolean>((resolve, reject) => {
      this.provisioningParameters = parameters;
      return resolve(true);
    });
  }

  /* Get the parameters for the Device Provisioning Service */
  public getProvisioningParameters(): HubProvisioningParameters | null {
    return this.provisioningParameters;
  }

  /* Register direct methods */
  public registerDirectMethod(name: string, method: Function) {
    this.directMethods.push({ name: name, function: method });
  }

  /* Handler for direct method invocations */
  private async handleDirectMethod(topic: string, payload: Buffer) {
    try {
      console.log(`[HubClient] Received direct method on topic: ${topic}`);
      console.log(`[HubClient] Payload: ${payload.toString('utf8')}`);
      
      // Decode UTF-8 payload
      const request = JSON.parse(payload.toString('utf8'));
      console.log(`[HubClient] Parsed request:`, request);
      console.log(`[HubClient] Looking for method: ${request?.name}`);
      console.log(`[HubClient] Registered methods:`, this.directMethods.map(m => m.name));
      
      // Find the registered method with this method name
      const directMethod = this.directMethods.find(obj => obj.name === request?.name);
      // If the method is not found, return 'not found' to caller
      if (!directMethod) {
        console.log(`[HubClient] Method '${request?.name}' not found`);
        return await this.respondToDirectMethod({ status: 404, message: 'Method not found', requestId: request.requestId });
      }
      
      console.log(`[HubClient] Invoking method: ${directMethod.name}`);
      // Invoke the direct method
      directMethod.function(request, new DirectMethodResponse(request.requestId, (response: any) => {
        console.log(`[HubClient] Method response:`, response);
        // Send a response to the invoker
        this.respondToDirectMethod(response);
      }));
    } catch (err) {
      console.error(`[HubClient] Error handling direct method:`, err);
      return await this.respondToDirectMethod({ httpStatusCode: 500, message: "That didn't work" });
    }
  }

  /* Send response to a direct method */
  private async respondToDirectMethod(response: any) {
    // Publish the response
    if (!this.client || !this.connectionParameters?.deviceId) return;
    this.client.publish(
      'edgeberry/things/' + this.connectionParameters.deviceId + '/methods/response/' + response.requestId,
      JSON.stringify(response),
      { qos: 0, retain: true }
    );
  }


  public connect(): Promise<string | boolean> {
    return new Promise<string | boolean>(async (resolve, reject) => {
      this.clientStatus.connecting = true;
      this.emit('connecting');

      if (!this.connectionParameters) return reject('Connection parameters not set');
      try {
        // Check the required X.509 parameters (matching AWS client)
        if (typeof this.connectionParameters.certificate !== 'string' || typeof this.connectionParameters.privateKey !== 'string') {
          return reject('X.509 authentication parameters incomplete');
        }
        
        // Build MQTT connection using mTLS (always use TLS for Device Hub)
        const url = `mqtts://${this.connectionParameters.hostName}:8883`;
        const options: IClientOptions = {
          clientId: this.connectionParameters.deviceId,
          reconnectPeriod: 2000,
          keepalive: 240,
          clean: false,
          cert: this.connectionParameters.certificate,
          key: this.connectionParameters.privateKey,
          rejectUnauthorized: true,
        };
        
        // Add root certificate if provided
        if (this.connectionParameters.rootCertificate) {
          (options as any).ca = this.connectionParameters.rootCertificate;
        }
        this.client = connect(url, options);

        // Events
        this.client.on('connect', () => this.clientConnectHandler());
        this.client.on('close', () => this.clientDisconnectHandler());
        this.client.on('error', (error: any) => this.clientErrorHandler(error));

        // Route messages to handlers
        this.client.on('message', (topic: string, payload: Buffer) => {
          if (!this.connectionParameters) return;
          const base = `$devicehub/devices/${this.connectionParameters.deviceId}/twin/update`;
          const methodBase = `$devicehub/devices/${this.connectionParameters.deviceId}/methods/post`;
          
          console.log(`[HubClient] Received message on topic: ${topic}`);
          console.log(`[HubClient] Expected method topic: ${methodBase}`);
          
          if (topic === `${base}/accepted` || topic === `${base}/rejected`) {
            this.twinUpdateResponseHandler(topic, payload);
          } else if (topic === `${base}/delta`) {
            this.twinDeltaHandler(topic, payload);
          } else if (topic === methodBase) {
            console.log(`[HubClient] Routing to handleDirectMethod`);
            this.handleDirectMethod(topic, payload);
          } else {
            console.log(`[HubClient] No handler for topic: ${topic}`);
          }
        });

        // Subscriptions (Twin accepted/rejected)
        this.client.subscribe(
          `$devicehub/devices/${this.connectionParameters.deviceId}/twin/update/accepted`,
          { qos: 1 },
          (err) => err && this.emit('error', err)
        );
        this.client.subscribe(
          `$devicehub/devices/${this.connectionParameters.deviceId}/twin/update/rejected`,
          { qos: 1 },
          (err) => err && this.emit('error', err)
        );
        this.client.subscribe(
          `$devicehub/devices/${this.connectionParameters.deviceId}/twin/update/delta`,
          { qos: 1 },
          (err) => err && this.emit('error', err)
        );
        
        // Subscribe to direct method calls
        this.client.subscribe(
          `$devicehub/devices/${this.connectionParameters.deviceId}/methods/post`,
          { qos: 0 },
          (err) => err && this.emit('error', err)
        );

        this.clientStatus.connecting = false;
        this.reconnectAttempts = 0;
        return resolve(true);
      } catch (err) {
        this.clientStatus.connecting = false;
        return reject(err);
      }
    });
  }

  private scheduleReconnect() {
    const maxDelayMs = 30000;
    const baseDelayMs = 1000;
    const jitterMs = 250;
    const attempt = Math.min(this.reconnectAttempts + 1, 10);
    const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs) + Math.floor(Math.random() * jitterMs);
    this.reconnectAttempts = attempt;
    setTimeout(() => {
      this.connect().catch(() => {
        /* swallow; next disconnect/error schedules again */
      });
    }, delay);
  }

  /* Send a generic application message (kept for API symmetry). Topic may be adjusted server-side. */
  public sendMessage(message: Message): Promise<string | boolean> {
    return new Promise(async (resolve, reject) => {
      if (!this.client || !this.connectionParameters) return reject('No client');
      const msg: any = { data: message.data };
      if (message.properties && message.properties.length > 0) {
        message.properties.forEach((p) => (msg[p.key] = p.value));
      }
      this.client.publish(
        `$devicehub/devices/${this.connectionParameters.deviceId}/messages/events`,
        JSON.stringify(msg),
        { qos: 1, retain: false },
        (err) => (err ? reject(err) : resolve(true))
      );
    });
  }

  /* Update reported device state (Twin) */
  public updateState(key: string, value: string | number | boolean | object): Promise<string | boolean> {
    return new Promise<string | boolean>(async (resolve, reject) => {
      if (!this.client || !this.clientStatus.connected || !this.connectionParameters) return reject('No connection');
      const reported: any = {};
      reported[key] = value;
      const body = { reported };
      this.client.publish(
        `$devicehub/devices/${this.connectionParameters.deviceId}/twin/update`,
        JSON.stringify(body),
        { qos: 1 },
        (err) => (err ? reject(err) : resolve('success'))
      );
    });
  }

  /* Handlers */
  private clientConnectHandler() {
    this.clientStatus.connected = true;
    this.emit('connected');
    this.emit('status', this.clientStatus);
    this.startHeartbeat();
  }

  private clientDisconnectHandler() {
    this.clientStatus.connected = false;
    this.emit('disconnected');
    this.emit('status', this.clientStatus);
    this.stopHeartbeat();
    this.scheduleReconnect();
  }

  private clientErrorHandler(error: any) {
    this.emit('error', error);
    this.scheduleReconnect();
  }

  private twinUpdateResponseHandler(topic: string, payload: Buffer) {
    try {
      const body = JSON.parse(payload.toString('utf8'));
      // Placeholder: emit as status or a dedicated event if desired by the app layer
      this.emit('twin', { topic, body });
    } catch (err) {
      this.emit('error', err);
    }
  }

  private twinDeltaHandler(topic: string, payload: Buffer) {
    try {
      const body = JSON.parse(payload.toString('utf8'));
      this.emit('twin-delta', { topic, body });
    } catch (err) {
      this.emit('error', err);
    }
  }

  /* Send heartbeat to maintain device online status */
  public sendHeartbeat(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.connectionParameters) return reject('No connection');
      this.client.publish(
        `$devicehub/devices/${this.connectionParameters.deviceId}/heartbeat`,
        JSON.stringify({ timestamp: Date.now() }),
        { qos: 0 },
        (err) => (err ? reject(err) : resolve(true))
      );
    });
  }

  /* Start automatic heartbeat */
  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat().catch(() => {
        // Heartbeat failed, but don't emit error as it's not critical
      });
    }, 30000); // Send heartbeat every 30 seconds
  }

  /* Stop automatic heartbeat */
  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /* Twin get helper: request current twin and await accepted */
  public getTwin(): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.connectionParameters) return reject('No connection');
      const deviceId = this.connectionParameters.deviceId;
      const accepted = `$devicehub/devices/${deviceId}/twin/update/accepted`;
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Twin get request timeout'));
      }, 10000); // 10 second timeout
      
      const onMessage = (topic: string, payload: Buffer) => {
        if (topic !== accepted) return;
        try {
          const body = JSON.parse(payload.toString('utf8'));
          cleanup();
          resolve(body);
        } catch (e) {
          cleanup();
          reject(e);
        }
      };
      const cleanup = () => {
        if (!this.client) return;
        clearTimeout(timeout);
        this.client.removeListener('message', onMessage);
      };
      this.client.on('message', onMessage);
      // Publish get
      this.client.publish(`$devicehub/devices/${deviceId}/twin/get`, '', { qos: 1 }, (err) => err && reject(err));
    });
  }

  /* Provision the Device Hub client using provisioning certificates */
  public provision(): Promise<string | boolean> {
    return new Promise<string | boolean>(async (resolve, reject) => {
      this.emit('provisioning');
      this.clientStatus.provisioning = true;
      
      if (!this.provisioningParameters) return reject('Provisioning parameters not set');

      try {
        // Check the required X.509 parameters
        if (typeof this.provisioningParameters.certificate !== 'string' || typeof this.provisioningParameters.privateKey !== 'string') {
          return reject('X.509 authentication parameters incomplete');
        }

        // Create provisioning client using provisioning certificates
        const url = `mqtts://${this.provisioningParameters.hostName}:8883`;
        const options: IClientOptions = {
          clientId: this.provisioningParameters.clientId, // Use UUID as clientId
          reconnectPeriod: 2000,
          clean: true,
          cert: this.provisioningParameters.certificate,
          key: this.provisioningParameters.privateKey,
          rejectUnauthorized: true,
        };
        
        if (this.provisioningParameters.rootCertificate) {
          (options as any).ca = this.provisioningParameters.rootCertificate;
        }

        const provisioningClient = connect(url, options);
        let certificate = '';
        let privateKey = '';

        // Use clientId (UUID) for provisioning topics
        const deviceId = this.provisioningParameters.clientId;
        const base = `$devicehub/devices/${deviceId}/provision`;

        const cleanup = () => {
          try {
            provisioningClient.removeAllListeners();
            provisioningClient.end(true);
          } catch {}
        };

        // Subscribe to provisioning responses
        provisioningClient.subscribe(`${base}/accepted`, { qos: 1 }, () => {});
        provisioningClient.subscribe(`${base}/rejected`, { qos: 1 }, () => {});

        provisioningClient.on('message', (topic: string, payload: Buffer) => {
          try {
            if (topic === `${base}/accepted`) {
              const response = JSON.parse(payload.toString('utf8'));
              certificate = response.certPem;
              // Note: Device Hub doesn't return privateKey in response, device generates its own
              
              const connectionParameters: HubConnectionParameters = {
                hostName: this.provisioningParameters?.hostName || '',
                deviceId: response.deviceId || this.provisioningParameters?.clientId || '',
                authenticationType: 'x509',
                certificate: certificate,
                privateKey: privateKey, // Use the generated private key
                rootCertificate: response.caChainPem || this.provisioningParameters?.rootCertificate
              };

              cleanup();
              this.clientStatus.provisioning = false;
              this.clientStatus.provisioned = true;
              this.emit('provisioned', connectionParameters);
              return resolve(true);
            } else if (topic === `${base}/rejected`) {
              const error = JSON.parse(payload.toString('utf8'));
              cleanup();
              this.clientStatus.provisioning = false;
              return reject(error);
            }
          } catch (e) {
            cleanup();
            this.clientStatus.provisioning = false;
            return reject(e);
          }
        });

        provisioningClient.on('error', (error: any) => {
          cleanup();
          this.clientStatus.provisioning = false;
          return reject(error);
        });

        provisioningClient.on('connect', () => {
          // Generate device key and CSR (following virtual-device pattern)
          const { spawn } = require('child_process');
          const { writeFileSync, mkdtempSync } = require('fs');
          const { tmpdir } = require('os');
          const path = require('path');
          
          try {
            const tmp = mkdtempSync(path.join(tmpdir(), 'edgeberry-provision-'));
            const keyPath = path.join(tmp, `${deviceId}.key`);
            const csrPath = path.join(tmp, `${deviceId}.csr`);
            
            // Generate private key
            const genKey = spawn('openssl', ['genrsa', '-out', keyPath, '2048'], { stdio: 'pipe' });
            genKey.on('close', (code: number) => {
              if (code !== 0) return reject('Failed to generate private key');
              
              // Generate CSR with CN = deviceId (UUID)
              const genCsr = spawn('openssl', ['req', '-new', '-key', keyPath, '-subj', `/CN=${deviceId}`, '-out', csrPath], { stdio: 'pipe' });
              genCsr.on('close', (code: number) => {
                if (code !== 0) return reject('Failed to generate CSR');
                
                try {
                  const fs = require('fs');
                  privateKey = fs.readFileSync(keyPath, 'utf8');
                  const csrPem = fs.readFileSync(csrPath, 'utf8');
                  
                  // Send provisioning request with CSR
                  const provisionPayload = {
                    csrPem,
                    uuid: deviceId,
                    name: `Device ${deviceId}`,
                    meta: { model: 'edgeberry', firmware: '1.0.0' }
                  };
                  
                  provisioningClient.publish(`${base}/request`, JSON.stringify(provisionPayload), { qos: 1 });
                } catch (e) {
                  cleanup();
                  this.clientStatus.provisioning = false;
                  return reject(e);
                }
              });
            });
          } catch (e) {
            cleanup();
            this.clientStatus.provisioning = false;
            return reject(e);
          }
        });

      } catch (err) {
        this.clientStatus.provisioning = false;
        this.clientStatus.provisioned = false;
        return reject(err);
      }
    });
  }

  /* Cleanup resources on disconnect */
  public async disconnect(): Promise<void> {
    this.stopHeartbeat();
    if (this.client !== null) {
      try {
        this.client.end(true, () => {});
        this.client.removeAllListeners();
        this.client = null;
      } catch (_err) {}
    }
  }
}
