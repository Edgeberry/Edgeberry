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

import { StateManager, deviceState } from './stateManager';
import { NetworkManager } from './networkManager';
import { NetworkReporter } from './networkReporter';
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

const stateManager    = new StateManager();
const networkManager  = new NetworkManager();
const webServer       = new WebServer();
const deviceHub       = new DeviceHubService(stateManager);
const apMode          = new ApModeService(stateManager, networkManager, webServer, deviceHub);
const networkReporter = new NetworkReporter(networkManager, deviceHub);

stateManager.updateSystemState('state', 'starting');

/* ── Wire ───────────────────────────────────────────────────── */

// Power and update operations report their lifecycle state through this,
// rather than importing the StateManager and creating a cycle.
setSystemStateReporter((state) => stateManager.updateSystemState('state', state));

webServer.use('/api', buildApiRouter({ stateManager, networkManager, apMode, deviceHub }));

// Direct methods are registered against each newly created hub client, before
// its connection is established — the library subscribes to their topics on
// connect, so registering afterwards would miss the subscription.
deviceHub.on('clientReady', () => registerDirectMethods(deviceHub, stateManager, networkReporter));

// Bridge cloud-to-device messages onto D-Bus for local applications.
deviceHub.on('cloudMessage', (message) => emitCloudMessage(message));

/*
 *  Report the network into the shadow as soon as there is a hub to report it
 *  to, and again on every reconnect.
 *
 *  publishState() drops what it cannot send rather than queueing it, so
 *  without this a device that booted onto a network and then stayed on it
 *  would carry no network document in its twin at all — there would be no
 *  change to trigger one, possibly for the life of the deployment.
 */
deviceHub.on('connected', () => {
    /*
     *  The state document too, for the same reason and one more.
     *
     *  publishStates() drops what it cannot send, and since the StateManager
     *  now emits only on an actual change, a device whose state was already
     *  settled before it reconnected would have nothing to trigger a publish
     *  with — leaving the shadow showing whatever it held before the
     *  disconnection, indefinitely.
     */
    deviceHub.publishStates(shadowPatch(stateManager.getState()));
    networkReporter.publishNow();
});

/*
 *  Broadcast state changes.
 *
 *  One D-Bus signal for local applications, one shadow update for the hub.
 *  Both carry the whole document rather than the field that moved: the
 *  StateManager now emits only when a value actually changed, so the thing
 *  this used to guard against — a broadcast per no-op write — is gone at the
 *  source.
 */
stateManager.on('state', (state) => {
    emitStateUpdate(state);
    deviceHub.publishStates(shadowPatch(state));
});

/*
 *  Shadow document layout.
 *
 *  Each section of the device state is its own top-level key, alongside the
 *  'network' key the NetworkReporter owns:
 *
 *      system       platform, state, version, board, board_version, uuid
 *      connection   provision, connection, network, wifi
 *      application  state, health, connection, version
 *      network      medium, interface, mac, ipv4, wifi, ...
 *
 *  Top-level keys are the unit the hub merges by — its setTwinDoc() replaces
 *  one key at a time — so a section is the natural thing to put there. It also
 *  makes 'network' a peer of the other sections instead of a sibling of a
 *  container holding everything else.
 *
 *  All of it goes in a single publish. Four keys through publishState() would
 *  be four MQTT messages and four merges into the twin database; publishStates()
 *  is one of each.
 *
 *  The deprecated nesting
 *  ----------------------
 *  This used to publish the entire state document under the single key
 *  'system', so the real values sat at doc.system.system.version and
 *  doc.system.connection.wifi — a key named after one of the three sections it
 *  contained.
 *
 *  The two shapes cannot sit side by side, because the legacy key and the new
 *  system key are the same key. So for one release the sections are *also*
 *  nested inside doc.system, which is purely additive: doc.system.version (new)
 *  and doc.system.system.version (old) both resolve.
 *
 *  Nothing in this repository or in the hub reads these names — every internal
 *  consumer passes the document through whole — so the duplication is there
 *  only for applications reading the twin through the hub's application API,
 *  which we cannot enumerate. Delete the three nested keys, and this note, once
 *  the fleet's applications have moved to the flat ones.
 */
function shadowPatch( state:deviceState ):Record<string, any>{
    return {
        system: {
            ...state.system,
            // DEPRECATED, remove after one release — see above.
            system:      state.system,
            connection:  state.connection,
            application: state.application,
        },
        connection:  state.connection,
        application: state.application,
    };
}

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
        // Associating, losing the link, or an AP-mode transition all change
        // what there is to report. The reporter decides whether anything
        // actually differs; this only tells it to look.
        networkReporter.nudge();
    }).catch(() => {});

    // Track whether traffic actually reaches the internet — associated with an
    // access point is not the same as online. Connectivity arriving is the cue
    // to retry the hub: at boot DNS may not be up yet, and AP mode cycles the
    // station connection out and back. The hub client does its own retrying
    // once it has a connection to lose, so this only nudges it when it has none.
    networkManager.subscribeToConnectivity((connectivity) => {
        const online = connectivity === 'full';
        stateManager.updateConnectionState('network', online ? 'connected' : 'disconnected');
        // The reporter carries the assessment rather than probing for its own:
        // CheckConnectivity is an active probe, and a second one would answer
        // about a different moment.
        networkReporter.onConnectivityChange(connectivity);
        if(online && !deviceHub.isConnected()) deviceHub.connect();
    }).catch(() => {});

    // Begin sampling. Publishing only starts once the hub connection is up —
    // the reporter checks for itself rather than being started from there.
    networkReporter.start();

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
