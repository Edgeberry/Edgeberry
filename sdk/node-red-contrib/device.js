module.exports = function(RED) {
  const { Edgeberry } = require('@edgeberry/device-sdk');

  function EdgeberryDeviceNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const edge = new Edgeberry();

    node.status({ fill: 'grey', shape: 'ring', text: 'disconnected' });

    function showConnection(connectionState) {
      switch (connectionState) {
        case 'connected':    node.status({ fill: 'green',  shape: 'dot',  text: 'connected' });    break;
        case 'connecting':   node.status({ fill: 'yellow', shape: 'ring', text: 'connecting' });   break;
        case 'disconnected': node.status({ fill: 'red',    shape: 'ring', text: 'disconnected' }); break;
        default:             node.status({ fill: 'grey',   shape: 'ring', text: connectionState || 'unknown' }); break;
      }
    }

    // Subscribe to cloud-to-device messages
    let unsubscribe = null;
    let unsubscribeState = null;
    (async () => {
      try {
        // Reflect the current connection state immediately.
        try {
          const current = await edge.getState();
          if (current && current.connection) showConnection(current.connection.connection);
        } catch (err) { /* ignore — state will arrive via subscription */ }

        unsubscribe = await edge.onCloudMessage((payload) => {
          node.send({
            topic: 'cloudMessage',
            payload,
            _msgid: RED.util.generateId()
          });
          node.log('Received cloud-to-device message');
        });
        unsubscribeState = await edge.onState((state) => {
          if (state && state.connection) showConnection(state.connection.connection);
        });
        node.log('Subscribed to cloud-to-device messages');
      } catch (err) {
        node.error(`Failed to subscribe to D-Bus signals: ${err}`);
      }
    })();

    const VALID_STATUS_LEVELS = ['ok', 'warning', 'error', 'critical', 'emergency'];

    function levelFill(level) {
      switch (level) {
        case 'ok':        return 'green';
        case 'warning':   return 'yellow';
        case 'error':
        case 'critical':
        case 'emergency': return 'red';
        default:          return 'grey';
      }
    }

    function showLevel(level, message) {
      const text = message ? `${level}: ${message}` : level;
      node.status({ fill: levelFill(level), shape: 'dot', text });
    }

    node.on('input', async function(msg) {
      try {
        if (msg.topic === 'identify') {
          await edge.identify();
          node.log('Sent identify request to Edgeberry');
        }
        else if (msg.topic === 'status') {
          const status = msg.payload;
          if (!status || typeof status !== 'object' || Array.isArray(status) || typeof status.level !== 'string') {
            node.warn("status: msg.payload must be { level: 'ok'|'warning'|'error'|'critical'|'emergency', message: string }");
          } else if (!VALID_STATUS_LEVELS.includes(status.level)) {
            node.warn(`status: invalid level '${status.level}' (expected one of ${VALID_STATUS_LEVELS.join(', ')})`);
          } else {
            await edge.setApplicationStatus({
              level: status.level,
              message: typeof status.message === 'string' ? status.message : '',
            });
            showLevel(status.level, typeof status.message === 'string' ? status.message : undefined);
            node.log('Sent application status to Edgeberry');
          }
        }
        else if (msg.topic === 'info') {
          if (msg.payload && typeof msg.payload === 'object') {
            await edge.setApplicationInfo(msg.payload);
            node.log('Sent application info to Edgeberry');
          } else {
            node.warn('info: msg.payload must be an ApplicationInfo object');
          }
        }
        else if (msg.topic === 'message' || msg.topic === 'telemetry') {
          const data = (msg.payload && msg.payload.data) || msg.payload;
          const result = await edge.sendMessage(data);
          if (result !== 'ok') {
            node.warn(`Message send returned: ${result}`);
          } else {
            node.log('Sent message to Device Hub');
          }
        }
      } catch (err) {
        node.error(`Edgeberry DBus error: ${err}`);
      }
      node.send(msg);
    });

    node.on('close', function(done) {
      try {
        if (unsubscribe) unsubscribe();
        if (unsubscribeState) unsubscribeState();
        edge.close();
      } catch (err) {
        node.error(`Error during close: ${err}`);
      }
      done();
    });
  }

  RED.nodes.registerType('edgeberry_device_device', EdgeberryDeviceNode);
};
