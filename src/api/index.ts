/*
 *  HTTP API
 *  Assembles the /api router from one sub-router per concern.
 *
 *  Routers are built by factories that take their dependencies as arguments,
 *  rather than importing singletons. That keeps the wiring in one place (the
 *  composition root) and is what allows the modules below to be read — or
 *  exercised — without starting the application.
 */

import { Router } from 'express';
import { StateManager } from '../stateManager';
import { NetworkManager } from '../networkManager';
import { ApModeService } from '../apMode';
import { DeviceHubService } from '../deviceHub';
import { buildStateRouter } from './state';
import { buildSystemRouter } from './system';
import { buildNetworkRouter } from './network';
import { buildCloudRouter } from './cloud';

export type ApiDeps = {
    stateManager:   StateManager;
    networkManager: NetworkManager;
    apMode:         ApModeService;
    deviceHub:      DeviceHubService;
};

export function buildApiRouter( deps:ApiDeps ):Router{
    const router = Router();

    // The state and system routers declare their own paths and mount at the
    // root: /api/state, /api/state/stream, /api/system/reboot — against
    // /api/network/... and /api/cloud/... which mount under a prefix.
    router.use('/',        buildStateRouter({ stateManager: deps.stateManager }));
    router.use('/',        buildSystemRouter({ stateManager: deps.stateManager }));
    router.use('/network', buildNetworkRouter({ networkManager: deps.networkManager, apMode: deps.apMode }));
    router.use('/cloud',   buildCloudRouter({ stateManager: deps.stateManager, deviceHub: deps.deviceHub }));

    return router;
}
