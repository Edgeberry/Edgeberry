/*
 *  example.ts
 *  End-to-end usage example for @edgeberry/device-sdk.
 *
 *  Run with:  npx ts-node example.ts
 *  (requires the Edgeberry Device Software to be running on the same host)
 */

import { Edgeberry } from './src';

async function main() {
  const device = new Edgeberry();

  // Announce this application to the Device Hub
  await device.setApplicationInfo({
    name: 'example',
    version: '3.5.3',
    description: 'Edgeberry Node SDK example',
  });

  await device.setApplicationStatus({ level: 'ok', message: 'Running fine' });

  // Subscribe to cloud-to-device messages
  const unsubscribe = await device.onCloudMessage((payload) => {
    console.log('Cloud message received:', payload);
  });

  // Send a telemetry sample every 5 seconds
  const interval = setInterval(async () => {
    try {
      const result = await device.sendMessage({
        temperature: 22.5 + Math.random(),
        humidity: 45 + Math.random() * 5,
      });
      if (result !== 'ok') console.warn('sendMessage returned:', result);
    } catch (err) {
      console.error('sendMessage failed:', err);
    }
  }, 5000);

  // Clean shutdown on Ctrl+C
  process.on('SIGINT', () => {
    clearInterval(interval);
    unsubscribe();
    device.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
