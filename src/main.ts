/*
 *  Edgeberry device software
 *  An application for using your Raspberry Pi as an edge device for your IoT project.
 *
 *  Copyright 2024 Sanne 'SpuQ' Santens
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

/*
 *  Composition root
 *
 *  This file builds the application's objects, wires them to each other, and
 *  starts them. It holds no behaviour of its own — every rule about how the
 *  device works lives in the module responsible for it.
 *
 *  Nothing imports this file, and nothing should: dependencies flow one way,
 *  outward from here. A module that reaches back for a singleton built here is
 *  an import cycle, and the workarounds for one cost more than passing the
 *  dependency in.
 */

import { StateManager } from './stateManager';
import { NetworkManager } from './networkManager';
import { WebServer } from './webServer';
import { DeviceHubService } from './deviceHub';
import { ApModeService } from './apMode';
import { buildApiRouter } from './api';
import { registerDirectMethods } from './directMethods';
import { startTerminalService } from './terminal';
import { settings_load } from './settingsStore';
import { registry_load } from './applicationRegistry';
import {
    startDbusInterface,
    emitCloudMessage,
    emitButtonEvent,
    emitStateUpdate,
} from './dbusInterface';
import {
    board_init,
    board_getProductName,
    board_getProductVersion,
    board_getUUID,
    board_button,
} from './board';
import {
    setSystemStateReporter,
    system_getApplicationInfo,
    system_getPlatform,
    system_restart,
} from './system';

/* ── Build ──────────────────────────────────────────────────── */

settings_load();

const stateManager   = new StateManager();
const networkManager = new NetworkManager();
const webServer      = new WebServer();
const deviceHub      = new DeviceHubService(stateManager);
const apMode         = new ApModeService(stateManager, networkManager, webServer, deviceHub);

stateManager.updateSystemState('state', 'starting');

/* ── Wire ───────────────────────────────────────────────────── */

// Power and update operations report their lifecycle state through this,
// rather than importing the StateManager and creating a cycle.
setSystemStateReporter((state) => stateManager.updateSystemState('state', state));

webServer.use('/api', buildApiRouter({ stateManager, networkManager, apMode, deviceHub }));

// Direct methods are registered against each newly created hub client, before
// its connection is established — the library subscribes to their topics on
// connect, so registering afterwards would miss the subscription.
deviceHub.on('clientReady', () => registerDirectMethods(deviceHub, stateManager, networkManager));

// Bridge cloud-to-device messages onto D-Bus for local applications.
deviceHub.on('cloudMessage', (message) => emitCloudMessage(message));

/*
 *  Broadcast state changes.
 *
 *  TODO: this reports the whole state object on every change to reduce chatter
 *  with the device shadow. Reporting each field independently would be better.
 */
stateManager.on('state', (state) => {
    emitStateUpdate(state);
    deviceHub.publishState('system', state);
});

/*
 *  Hardware button.
 *
 *  Every event is forwarded to D-Bus so applications can react to physical
 *  interaction. Local behaviour (acknowledge beep, long-press reboot) is wired
 *  inside board.ts, since it needs no application state.
 */
(['click', 'pressrelease', 'apToggle', 'longpress', 'verylongpress'] as const)
    .forEach((event) => board_button.on(event, () => emitButtonEvent(event)));

/*
 *  A ~3 second press toggles AP mode.
 *
 *  DO NOT REMOVE: this is the only recovery path for a device carrying a saved
 *  network it can no longer reach, after a move for example. There is
 *  deliberately no automatic fallback into AP mode, and the web interface is
 *  unreachable in exactly that situation — the device is on no network to serve
 *  it from. The physical button is load-bearing.
 */
board_button.on('apToggle', () => apMode.toggle(board_getUUID()));

// A ~5 second press reboots the host. Wired here rather than in board.ts
// because the board asking the Linux system to restart crosses a boundary the
// board itself should know nothing about.
board_button.on('longpress', () => system_restart());

startDbusInterface({ stateManager, deviceHub });

/* ── Start ──────────────────────────────────────────────────── */

async function start():Promise<void>{
    board_init();

    // Re-read the registered application's manifest and make routes.d/ match it.
    // Done before the web interface comes up so the application's paths are
    // already routed by the time anything can ask for them, and so a routes.d/
    // lost to a deploy is rebuilt rather than silently staying gone.
    registry_load();

    // Identity and platform, best-effort: a device without the Edgeberry HAT
    // still runs, it just cannot report which board it is.
    try{
        stateManager.updateSystemState('platform',      await system_getPlatform());
        stateManager.updateSystemState('board',         board_getProductName());
        stateManager.updateSystemState('board_version', board_getProductVersion());
        stateManager.updateSystemState('uuid',          board_getUUID());
        stateManager.updateSystemState('version',       (await system_getApplicationInfo())?.version);
    } catch(_err){}

    // The web interface starts unconditionally and stays up, so the device is
    // reachable regardless of network or cloud state. nginx proxies :80 to it.
    webServer.start();
    const httpServer = webServer.getHttpServer();
    if(httpServer) startTerminalService(httpServer);

    // Keep connection.wifi in step with the radio. AP mode is excluded because
    // the transitions manage that value themselves, and NetworkManager reports
    // an access point as 'disconnected' from a station point of view.
    networkManager.subscribeToWifiState((state) => {
        if(!apMode.isActive()) stateManager.updateConnectionState('wifi', state);
    }).catch(() => {});

    // Track whether traffic actually reaches the internet — associated with an
    // access point is not the same as online. Connectivity arriving is the cue
    // to retry the hub: at boot DNS may not be up yet, and AP mode cycles the
    // station connection out and back. The hub client does its own retrying
    // once it has a connection to lose, so this only nudges it when it has none.
    networkManager.subscribeToConnectivity((connectivity) => {
        const online = connectivity === 'full';
        stateManager.updateConnectionState('network', online ? 'connected' : 'disconnected');
        if(online && !deviceHub.isConnected()) deviceHub.connect();
    }).catch(() => {});

    // Decide between setup and normal operation.
    //
    // Wrapped in a timeout because a device using dhcpcd rather than
    // NetworkManager has nobody to answer this, and the D-Bus call hangs
    // indefinitely instead of failing.
    try{
        // Clear AP profiles orphaned by an unclean shutdown first: an orphan is
        // indistinguishable from a configured network to the check below, and
        // would permanently suppress automatic AP mode.
        await Promise.race([
            networkManager.deleteOrphanedApProfiles(),
            new Promise<void>((resolve) => setTimeout(resolve, 5000)),
        ]);

        const hasWifi = await Promise.race([
            networkManager.hasSavedWifiConnection(),
            new Promise<null>((_, reject) =>
                setTimeout(() => reject(new Error('WiFi check timed out')), 5000)),
        ]);

        if(hasWifi === false){
            await apMode.enter(board_getUUID());
            return;
        }
    } catch(err){
        console.error('\x1b[31mWiFi check failed: '+err+'\x1b[37m');
    }

    await deviceHub.connect();
}

start()
    .then(() => stateManager.updateSystemState('state', 'running'))
    .catch((err) => {
        console.error('\x1b[31mStartup failed: '+err+'\x1b[37m');
        stateManager.updateSystemState('state', 'running');
    });
