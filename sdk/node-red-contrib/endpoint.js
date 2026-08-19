/**
 * Endpoint nodes for the Edgeberry bridge - device side.
 *
 * A matching pair exists in the cloud (@edgeberry/devicehub-node-red-contrib).
 * Between them a message keeps its shape: what a flow sends on one side is what
 * the flow on the other side receives.
 *
 *   [ ->  from cloud ]   messages arriving from the cloud
 *   [ <-  to cloud   ]   messages sent to the cloud
 *
 * The contract is `msg.topic` + `msg.payload`, carried in a small envelope so
 * that no value is reshaped in transit:
 *
 *   { eb: { v: 1, topic, timestamp, payload } }
 *
 * It is nested under one key rather than spread across the message because the
 * Core wraps outbound data as { deviceId, timestamp, ...yours } - a top-level
 * `timestamp` of ours would silently replace the one it stamps. Nesting also
 * lets `payload` hold any JSON value: a primitive spread into an object
 * disappears, while a nested one survives as itself.
 */

const ENVELOPE_VERSION = 1;

module.exports = function(RED) {
  const { Edgeberry } = require('@edgeberry/device-sdk');

  /**
   * Match a received topic against a node's configured one. Exact by default;
   * `*` takes everything and a trailing `*` matches a prefix, so one node can
   * watch a whole family of topics.
   */
  function topicMatches(configured, received) {
    if (typeof received !== 'string') return false;
    if (!configured || configured === '*') return true;
    if (configured.endsWith('*')) return received.startsWith(configured.slice(0, -1));
    return configured === received;
  }

  /** Read an envelope out of a cloud-to-device payload, or null if it isn't one. */
  function unpack(payload) {
    const eb = payload && payload.eb;
    if (!eb || typeof eb !== 'object' || typeof eb.topic !== 'string') return null;
    return eb;
  }

  /**
   * from cloud - messages arriving from the cloud, filtered to one topic.
   */
  function FromCloudNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const edge = new Edgeberry();

    node.topic = config.topic;

    let unsubscribe = null;
    let unsubscribeState = null;

    function showConnection(state) {
      switch (state) {
        case 'connected':    node.status({ fill: 'green',  shape: 'dot',  text: node.topic || '*' }); break;
        case 'connecting':   node.status({ fill: 'yellow', shape: 'ring', text: 'connecting' });      break;
        case 'disconnected': node.status({ fill: 'red',    shape: 'ring', text: 'disconnected' });    break;
        default:             node.status({ fill: 'grey',   shape: 'ring', text: state || 'unknown' });break;
      }
    }

    node.status({ fill: 'grey', shape: 'ring', text: 'disconnected' });

    (async () => {
      try {
        try {
          const current = await edge.getState();
          if (current && current.connection) showConnection(current.connection.connection);
        } catch (err) { /* state will arrive via subscription */ }

        unsubscribe = await edge.onCloudMessage((payload) => {
          const eb = unpack(payload);
          if (!eb) return;                                   // not endpoint traffic
          if (!topicMatches(node.topic, eb.topic)) return;   // another endpoint's
          node.send({
            topic: eb.topic,
            payload: eb.payload,
            timestamp: eb.timestamp
          });
        });

        unsubscribeState = await edge.onState((state) => {
          if (state && state.connection) showConnection(state.connection.connection);
        });
      } catch (err) {
        node.error(`Failed to subscribe to cloud messages: ${err}`);
      }
    })();

    node.on('close', function(done) {
      try {
        if (unsubscribe) unsubscribe();
        if (unsubscribeState) unsubscribeState();
      } catch (err) { /* shutting down anyway */ }
      done();
    });
  }

  /**
   * to cloud - send a message to the cloud under this endpoint's topic.
   */
  function ToCloudNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const edge = new Edgeberry();

    node.topic = config.topic;

    let unsubscribeState = null;

    function showConnection(state) {
      switch (state) {
        case 'connected':    node.status({ fill: 'green',  shape: 'dot',  text: node.topic }); break;
        case 'connecting':   node.status({ fill: 'yellow', shape: 'ring', text: 'connecting' }); break;
        case 'disconnected': node.status({ fill: 'red',    shape: 'ring', text: 'disconnected' }); break;
        default:             node.status({ fill: 'grey',   shape: 'ring', text: state || 'unknown' }); break;
      }
    }

    node.status({ fill: 'grey', shape: 'ring', text: 'disconnected' });

    if (!node.topic || node.topic.includes('*')) {
      node.error('A concrete topic is required to send (wildcards are for receiving)');
      node.status({ fill: 'red', shape: 'ring', text: 'no topic' });
      return;
    }

    (async () => {
      try {
        const current = await edge.getState();
        if (current && current.connection) showConnection(current.connection.connection);
        unsubscribeState = await edge.onState((state) => {
          if (state && state.connection) showConnection(state.connection.connection);
        });
      } catch (err) { /* status only; sending is unaffected */ }
    })();

    node.on('input', async function(msg, send, done) {
      // The node is the endpoint, so its configured topic is authoritative. A
      // message arriving under a different one is a wiring mistake worth saying
      // out loud rather than passing along silently.
      if (msg.topic && msg.topic !== node.topic) {
        node.warn(`topic "${msg.topic}" overridden with this endpoint's topic "${node.topic}"`);
      }

      const envelope = {
        eb: {
          v: ENVELOPE_VERSION,
          topic: node.topic,
          // Stamped once, at the origin, and never rewritten downstream: the
          // receiving flow sees when this message was sent, not when it landed.
          timestamp: msg.timestamp || new Date().toISOString(),
          payload: msg.payload === undefined ? null : msg.payload
        }
      };

      try {
        const result = await edge.sendMessage(envelope);
        if (result !== 'ok') {
          // Nothing queues while the hub is unreachable, so a failure here is a
          // dropped message, not a delayed one.
          const err = new Error(`message not sent (${result})`);
          if (done) done(err); else node.error(err.message, msg);
          return;
        }
        if (done) done();
      } catch (err) {
        if (done) done(err); else node.error(`${err}`, msg);
      }
    });

    node.on('close', function(done) {
      try { if (unsubscribeState) unsubscribeState(); } catch (err) { /* shutting down */ }
      done();
    });
  }

  RED.nodes.registerType('edgeberry_device_from_cloud', FromCloudNode);
  RED.nodes.registerType('edgeberry_device_to_cloud', ToCloudNode);
};
