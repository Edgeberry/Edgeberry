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

    node.status({ fill: 'grey', shape: 'ring', text: 'connecting' });

    function describeStatus(state) {
      // Try to give a compact human-readable status line for the node badge.
      if (!state) return '';
      if (state.system && state.system.state && state.system.state !== 'running') {
        return `system:${state.system.state}`;
      }
      if (state.connection && state.connection.connection) {
        return `cloud:${state.connection.connection}`;
      }
      if (state.application && state.application.state) {
        return `app:${state.application.state}`;
      }
      return 'ok';
    }

    function emit(state) {
      const slice = section ? state[section] : state;
      if (onlyOnChange) {
        const json = JSON.stringify(slice);
        if (json === lastSectionJson) return;
        lastSectionJson = json;
      }
      node.status({ fill: 'green', shape: 'dot', text: describeStatus(state) });
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
    // Accepts:
    //   msg.payload = { level: 'ok'|'warning'|'error'|..., message?: string }
    //   msg.payload = 'ok'                (level only; string form)
    //   msg.payload = { status: {...} }   (same wrapping used by the 'edgeberry' node)
    node.on('input', async function(msg, send, done) {
      try {
        let status = msg.payload;
        if (status && typeof status === 'object' && status.status) status = status.status;
        if (typeof status === 'string') status = { level: status };
        if (!status || typeof status !== 'object' || !status.level) {
          node.warn('status: msg.payload must be { level, message? } or a level string');
          if (done) done();
          return;
        }
        const result = await edge.setApplicationStatus(status);
        if (result !== 'ok') node.warn(`setApplicationStatus returned: ${result}`);
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
