module.exports = function(RED) {
  const { Edgeberry } = require('@edgeberry/device-sdk');

  function EdgeberryDeviceNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const edge = new Edgeberry();

    // Subscribe to cloud-to-device messages
    let unsubscribe = null;
    (async () => {
      try {
        unsubscribe = await edge.onCloudMessage((payload) => {
          node.send({
            topic: 'cloudMessage',
            payload,
            _msgid: RED.util.generateId()
          });
          node.log('Received cloud-to-device message');
        });
        node.log('Subscribed to cloud-to-device messages');
      } catch (err) {
        node.error(`Failed to subscribe to D-Bus signals: ${err}`);
      }
    })();

    node.on('input', async function(msg) {
      try {
        if (msg.payload && msg.payload.info) {
          await edge.setApplicationInfo(msg.payload.info);
          node.log('Sent application info to Edgeberry');
        }
        if (msg.payload && msg.payload.status) {
          await edge.setApplicationStatus(msg.payload.status);
          node.log('Sent application status to Edgeberry');
        }
        if (msg.topic === 'identify') {
          await edge.identify();
          node.log('Sent identify request to Edgeberry');
        }
        if (msg.topic === 'message' || msg.topic === 'telemetry' || (msg.payload && msg.payload.data)) {
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
        edge.close();
      } catch (err) {
        node.error(`Error during close: ${err}`);
      }
      done();
    });
  }

  RED.nodes.registerType('edgeberry_device_device', EdgeberryDeviceNode);
};
