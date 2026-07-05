module.exports = function(RED) {
  const { Edgeberry } = require('@edgeberry/device-sdk');

  function EdgeberryButtonNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    // Optional event filter, e.g. "click,longpress" — empty means all events
    const filter = (config.events || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const edge = new Edgeberry();
    let unsubscribe = null;

    node.status({ fill: 'grey', shape: 'ring', text: 'connecting' });

    (async () => {
      try {
        unsubscribe = await edge.onButtonEvent((event) => {
          if (filter.length > 0 && !filter.includes(event.event)) return;
          node.status({ fill: 'green', shape: 'dot', text: event.event });
          node.send({
            topic: event.event,
            payload: event,
            _msgid: RED.util.generateId(),
          });
        });
        node.status({ fill: 'green', shape: 'ring', text: 'ready' });
      } catch (err) {
        node.status({ fill: 'red', shape: 'ring', text: 'error' });
        node.error(`Failed to subscribe to button events: ${err}`);
      }
    })();

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

  RED.nodes.registerType('edgeberry_device_button', EdgeberryButtonNode);
};
