/*
 *  Application manifest
 *
 *  A device runs one application, and that application describes itself in an
 *  `edgeberry.json` shipped inside its own directory (/opt/Freya/edgeberry.json).
 *  Registering it stores only the path — the manifest stays with the application
 *  and is versioned alongside it, so an application update carries its own
 *  description with it.
 *
 *  Edgeberry owns nginx. An application never writes into routes.d/ itself; the
 *  location blocks there are generated from the manifest and regenerated on
 *  every registration and every start. That makes routes.d/ derived state: it
 *  can be deleted and it comes back, which is what stops a deploy that wipes it
 *  from silently unrouting the device's application.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';

import { ApplicationRoute, slugify } from './application';

/** Filename an application publishes inside its own directory. */
export const MANIFEST_FILENAME = 'edgeberry.json';

/*
 *  Paths, relative to the working directory that systemd sets to the
 *  application directory — the same convention settingsStore.ts uses.
 */
const ROUTES_DIR = 'config/nginx/routes.d';

/** Lifecycle actions an application can declare that Edgeberry may perform. */
export const LIFECYCLE_ACTIONS = ['start', 'stop', 'restart', 'reload'] as const;
export type LifecycleAction = typeof LIFECYCLE_ACTIONS[number];

export type ApplicationManifest = {
    name:         string,
    version?:     string,
    description?: string,
    ui?: {
        /**
         * Loopback port the application's own web server listens on.
         *
         * Only the port is declared here, because it is a fact about how the
         * application was installed. Which paths it serves is something the
         * application knows as it runs, and it declares those over D-Bus —
         * Edgeberry proxies each of them to this port.
         */
        port: number,
    },
    service?: {
        unit:     string,
        supports: LifecycleAction[],
    },
}

/** A registered application: where it lives, and what it says about itself. */
export type RegisteredApplication = {
    path:     string,
    manifest: ApplicationManifest,
}

/*
 *  Reading and validating
 */

/**
 * Read and validate the manifest in an application's directory.
 *
 * Throws with a message meant to be read by whoever ran the registration —
 * a packager gets to find out at install time rather than when someone clicks
 * a menu item months later.
 */
export function readManifest( applicationPath:string ):ApplicationManifest{
    const file = path.join(applicationPath, MANIFEST_FILENAME);
    if(!existsSync(file)) throw new Error(`no ${MANIFEST_FILENAME} in ${applicationPath}`);

    let raw:any;
    try{
        raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch(err:any){
        throw new Error(`${file} is not valid JSON: ${err.message}`);
    }
    if(!raw || typeof raw !== 'object') throw new Error(`${file} must contain an object`);

    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if(!name) throw new Error(`${file}: 'name' is required`);
    // The name becomes a filename in routes.d/, so it has to reduce to something
    // that is one.
    if(!slugify(name)) throw new Error(`${file}: 'name' must contain letters or digits`);

    const manifest:ApplicationManifest = { name };
    if(typeof raw.version === 'string')     manifest.version     = raw.version;
    if(typeof raw.description === 'string') manifest.description = raw.description;

    if(raw.ui !== undefined)      manifest.ui      = readUi(raw.ui, file);
    if(raw.service !== undefined) manifest.service = readService(raw.service, file);

    return manifest;
}

function readUi( ui:any, file:string ):ApplicationManifest['ui']{
    if(!ui || typeof ui !== 'object') throw new Error(`${file}: 'ui' must be an object`);

    const port = ui.port;
    if(!Number.isInteger(port) || port < 1 || port > 65535)
        throw new Error(`${file}: 'ui.port' must be a port number, got ${JSON.stringify(port)}`);

    return { port };
}

function readService( service:any, file:string ):ApplicationManifest['service']{
    if(!service || typeof service !== 'object') throw new Error(`${file}: 'service' must be an object`);

    const unit = typeof service.unit === 'string' ? service.unit.trim() : '';
    if(!unit) throw new Error(`${file}: 'service.unit' is required when 'service' is given`);
    if(!/^[A-Za-z0-9@._\-\\]+\.(service|socket|target)$/.test(unit))
        throw new Error(`${file}: '${unit}' is not a systemd unit name`);

    // Verified now so a packager finds out here, rather than someone discovering
    // it from a Restart button that quietly does nothing.
    if(spawnSync('systemctl', ['cat', unit], { stdio: 'ignore' }).status !== 0)
        throw new Error(`${file}: systemd does not know the unit '${unit}'`);

    const declared = Array.isArray(service.supports) ? service.supports : ['restart'];
    const supports = LIFECYCLE_ACTIONS.filter(action => declared.includes(action));
    if(!supports.length)
        throw new Error(`${file}: 'service.supports' must list at least one of ${LIFECYCLE_ACTIONS.join(', ')}`);

    return { unit, supports };
}

/*
 *  nginx
 */

/**
 * First line of every file this module writes.
 *
 * It is how a generated file is told apart from one an application installed
 * itself, back when routes.d/ was the documented way to add routes. Edgeberry
 * removes what it wrote; it does not remove what it did not.
 */
const GENERATED_MARKER = '# Generated by Edgeberry';

/** Everything below this prefix belongs to the application. */
export const APPLICATION_PREFIX = '/application';

/**
 * One pass-through to the application's port.
 *
 * nginx is deliberately ignorant of the application's route tree: it forwards
 * everything under the prefix and strips it, so the application sees its own
 * paths and is free to change them without the device regenerating anything.
 * The only thing this depends on is the port, which is settled at install.
 *
 * The stripping is why an application has to emit relative URLs, or read
 * X-Forwarded-Prefix: an absolute '/editor/style.css' in its HTML leaves the
 * prefix behind and lands on the device's catch-all.
 */
export function renderNginxConf( manifest:ApplicationManifest ):string{
    const proxyParams = path.join(process.cwd(), 'config/nginx/proxy_params');
    const header =
        `${GENERATED_MARKER} for '${manifest.name}'.\n` +
        `# Regenerated from its manifest on registration and on every start —\n` +
        `# edits here are lost.\n\n`;

    if(!manifest.ui) return header;

    return header +
        `# Without this, '${APPLICATION_PREFIX}' with no trailing slash falls through to\n` +
        `# the device interface instead of reaching the application.\n` +
        `location = ${APPLICATION_PREFIX} {\n` +
        `    return 301 ${APPLICATION_PREFIX}/;\n` +
        `}\n\n` +
        `# The trailing slash on proxy_pass is what strips the prefix.\n` +
        `location ${APPLICATION_PREFIX}/ {\n` +
        `    proxy_pass http://127.0.0.1:${manifest.ui.port}/;\n` +
        `    include ${proxyParams};\n` +
        `    # For applications that can mount themselves under a prefix.\n` +
        `    proxy_set_header X-Forwarded-Prefix ${APPLICATION_PREFIX};\n` +
        `}\n`;
}

/**
 * Make routes.d/ match the registered application, and say whether anything
 * changed.
 *
 * Files Edgeberry generated are always brought into line — a rename or an
 * unregistration must not leave an old conf behind still claiming paths.
 *
 * Files it did not generate are left alone unless `adopt` is set. Sweeping them
 * on every start would delete the hand-installed routes of an application that
 * simply has not been registered yet, silently unrouting a working device on
 * the first restart after an update. `adopt` is passed only from registration,
 * where someone has explicitly said what the routing should now be — and where
 * leaving a stale file would give nginx two location blocks for one path.
 *
 * Returning whether anything changed keeps a reload off the common path: on
 * most starts the file is already exactly right.
 */
export function syncNginxRoutes( application:RegisteredApplication|null, adopt = false ):boolean{
    mkdirSync(ROUTES_DIR, { recursive: true });

    const wanted = application
        ? { file: path.join(ROUTES_DIR, `${slugify(application.manifest.name)}.conf`),
            body: renderNginxConf(application.manifest) }
        : null;

    let changed = false;

    for(const entry of readdirSync(ROUTES_DIR)){
        if(!entry.endsWith('.conf')) continue;
        const file = path.join(ROUTES_DIR, entry);
        if(wanted && file === wanted.file) continue;

        const isOurs = readFileSync(file, 'utf8').startsWith(GENERATED_MARKER);
        if(!isOurs && !adopt){
            console.log('\x1b[90mLeaving unmanaged nginx route '+entry+
                        ' in place (no application registered for it)\x1b[37m');
            continue;
        }

        if(isOurs){
            // Ours, and regenerable from the manifest — nothing to preserve.
            console.log('\x1b[33mRemoving stale nginx route '+entry+'\x1b[37m');
            rmSync(file);
        }
        else{
            // Somebody else's, and the only copy: an application installed it by
            // hand and nothing here can reconstruct it. Kept beside the include
            // glob rather than deleted, so adopting a live device stays
            // reversible by hand.
            const kept = file+'.replaced';
            console.log('\x1b[33mAdopting routes from '+entry+' (previous file kept as '+path.basename(kept)+')\x1b[37m');
            renameSync(file, kept);
        }
        changed = true;
    }

    if(wanted){
        const current = existsSync(wanted.file) ? readFileSync(wanted.file, 'utf8') : null;
        if(current !== wanted.body){
            writeFileSync(wanted.file, wanted.body);
            changed = true;
        }
    }

    return changed;
}

/**
 * Check the configuration, then reload nginx. Never the other way round: a
 * generated config that fails to parse takes the device's web interface down,
 * including the page anyone would use to put it back.
 */
export function reloadNginx():void{
    const test = spawnSync('nginx', ['-t'], { encoding: 'utf8' });
    if(test.status !== 0)
        throw new Error('nginx rejected the generated configuration: '+(test.stderr || test.stdout || '').trim());

    const reload = spawnSync('systemctl', ['reload', 'nginx'], { encoding: 'utf8' });
    if(reload.status !== 0)
        throw new Error('nginx reload failed: '+(reload.stderr || reload.stdout || '').trim());
}

/*
 *  Lifecycle
 */

/** Perform a declared lifecycle action on the application's systemd unit. */
export function runLifecycleAction( manifest:ApplicationManifest, action:LifecycleAction ):void{
    const service = manifest.service;
    if(!service) throw new Error(`${manifest.name} declares no service to act on`);
    if(!service.supports.includes(action))
        throw new Error(`${manifest.name} does not support '${action}'`);

    const result = spawnSync('systemctl', [action, service.unit], { encoding: 'utf8' });
    if(result.status !== 0)
        throw new Error(`systemctl ${action} ${service.unit} failed: `+(result.stderr || result.stdout || '').trim());
}
