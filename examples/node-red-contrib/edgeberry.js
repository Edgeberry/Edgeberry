module.exports = function(RED) {
  const dbus = require('dbus-next');
  const bus = dbus.systemBus();

  async function sendAppInfo(info) {
    const service = await bus.getProxyObject('io.edgeberry.Core', '/io/edgeberry/Core');
    const iface = service.getInterface('io.edgeberry.Core');
    await iface.SetApplicationInfo(JSON.stringify(info));
  }

  async function sendAppStatus(status) {
    const service = await bus.getProxyObject('io.edgeberry.Core', '/io/edgeberry/Core');
    const iface = service.getInterface('io.edgeberry.Core');
    await iface.SetApplicationStatus(JSON.stringify(status));
  }

  async function sendIdentify() {
    const service = await bus.getProxyObject('io.edgeberry.Core', '/io/edgeberry/Core');
    const iface = service.getInterface('io.edgeberry.Core');
    await iface.Identify();
  }

  async function sendMessage(data) {
    const service = await bus.getProxyObject('io.edgeberry.Core', '/io/edgeberry/Core');
    const iface = service.getInterface('io.edgeberry.Core');
    const result = await iface.SendMessage(JSON.stringify(data));
    return result;
  }

  function EdgeberryNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    // Subscribe to CloudMessage D-Bus signal for cloud-to-device messages
    (async () => {
      try {
        const service = await bus.getProxyObject('io.edgeberry.Core', '/io/edgeberry/Core');
        const iface = service.getInterface('io.edgeberry.Core');
        
        // Listen for CloudMessage signals
        iface.on('CloudMessage', (messageJson) => {
          try {
            const payload = JSON.parse(messageJson);
            node.send({
              topic: 'cloudMessage',
              payload: payload,
              _msgid: RED.util.generateId()
            });
            node.log('Received cloud-to-device message');
          } catch (err) {
            node.error(`Failed to parse cloud message: ${err}`);
          }
        });
        
        node.log('Subscribed to cloud-to-device messages');
      } catch (err) {
        node.error(`Failed to subscribe to D-Bus signals: ${err}`);
      }
    })();

    node.on('input', async function(msg) {
      try {
        if (msg.payload.info) {
          await sendAppInfo(msg.payload.info);
          node.log('Sent application info to Edgeberry');
        }
        if (msg.payload.status) {
          await sendAppStatus(msg.payload.status);
          node.log('Sent application status to Edgeberry');
        }
        if (msg.topic === "identify" ) {
          await sendIdentify();
          node.log('Sent identify request to Edgeberry');
        }
        if (msg.topic === "message" || msg.topic === "telemetry" || msg.payload.data) {
          // Send telemetry/message data to Device Hub
          const data = msg.payload.data || msg.payload;
          const result = await sendMessage(data);
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
  }

  RED.nodes.registerType("edgeberry", EdgeberryNode);
}