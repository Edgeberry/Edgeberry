module.exports = function(RED) {
  const { Edgeberry } = require('@edgeberry/device-sdk');

  function EdgeberryStatusNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    // Optional filter: only emit when a specific top-level section changes.
    // 'all' emits on every update. Otherwise: 'system' | 'connection' | 'application'.
    const section = config.section && config.section !== 'all' ? config.section : null;
    // If enabled, only emit when the selected section actually changed vs. last emit.
    const onlyOnChange = config.onlyOnChange !== false;

    const edge = new Edgeberry();
    let unsubscribe = null;
    let lastSectionJson = null;

    node.status({ fill: 'grey', shape: 'ring', text: 'idle' });

    // Map a health level to a Node-RED badge fill colour.
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

    // Update the node badge to reflect the last-sent application health level.
    function showLevel(level, message) {
      const text = message ? `${level}: ${message}` : level;
      node.status({ fill: levelFill(level), shape: 'dot', text });
    }

    function emit(state) {
      const slice = section ? state[section] : state;
      if (onlyOnChange) {
        const json = JSON.stringify(slice);
        if (json === lastSectionJson) return;
        lastSectionJson = json;
      }
      node.send({
        topic: section ? `state.${section}` : 'state',
        payload: slice,
        state,
        _msgid: RED.util.generateId(),
      });
    }

    (async () => {
      try {
        // Emit the current state immediately so downstream nodes get a baseline.
        try {
          const current = await edge.getState();
          emit(current);
        } catch (err) {
          node.warn(`Initial getState failed: ${err}`);
        }
        unsubscribe = await edge.onState((state) => emit(state));
      } catch (err) {
        node.status({ fill: 'red', shape: 'ring', text: 'error' });
        node.error(`Failed to subscribe to state updates: ${err}`);
      }
    })();

    // Input path: set the application status on this device.
    // Canonical Node-RED API format:
    //   msg.topic   = 'status'
    //   msg.payload = { level: 'ok'|'warning'|'error'|'critical'|'emergency', message: string }
    const VALID_LEVELS = ['ok', 'warning', 'error', 'critical', 'emergency'];
    node.on('input', async function(msg, send, done) {
      try {
        if (msg.topic && msg.topic !== 'status') {
          node.warn(`status: ignoring msg with topic '${msg.topic}' (expected 'status')`);
          if (done) done();
          return;
        }
        const status = msg.payload;
        if (!status || typeof status !== 'object' || Array.isArray(status) || typeof status.level !== 'string') {
          node.warn("status: msg.payload must be { level: 'ok'|'warning'|'error'|'critical'|'emergency', message: string }");
          if (done) done();
          return;
        }
        if (!VALID_LEVELS.includes(status.level)) {
          node.warn(`status: invalid level '${status.level}' (expected one of ${VALID_LEVELS.join(', ')})`);
          if (done) done();
          return;
        }
        const result = await edge.setApplicationStatus({
          level: status.level,
          message: typeof status.message === 'string' ? status.message : '',
        });
        if (result !== 'ok') node.warn(`setApplicationStatus returned: ${result}`);
        else showLevel(status.level, typeof status.message === 'string' ? status.message : undefined);
        if (done) done();
      } catch (err) {
        if (done) done(err);
        else node.error(`Edgeberry status error: ${err}`);
      }
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

  RED.nodes.registerType('edgeberry_device_status', EdgeberryStatusNode);
};
