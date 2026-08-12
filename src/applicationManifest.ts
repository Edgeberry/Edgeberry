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

import { slugify } from './application';
import { HOSTNAME_LABEL, MAX_PREFIX_LENGTH } from './hostname';

/** Filename an application publishes inside its own directory. */
const MANIFEST_FILENAME = 'edgeberry.json';

/*
 *  Paths, relative to the working directory that systemd sets to the
 *  application directory — the same convention settingsStore.ts uses.
 */
const ROUTES_DIR = 'config/nginx/routes.d';

/** Lifecycle actions an application can declare that Edgeberry may perform. */
const LIFECYCLE_ACTIONS = ['start', 'stop', 'restart', 'reload'] as const;
export type LifecycleAction = typeof LIFECYCLE_ACTIONS[number];

/**
 * Artwork the application supplies to brand the device interface.
 *
 * Declared in the manifest as paths relative to the application's own
 * directory, and kept here resolved to absolute paths — validated once at
 * registration so serving them later is just reading a file.
 *
 * The two shapes match what the device already ships for itself: a wide logo
 * for the navigation bar, and a square mark for the browser tab.
 */
type ApplicationBranding = {
    logo?:   string,
    mark?:   string,
    /** Theme token overrides, keyed by the part after '--eb-'. */
    colors?: Record<string, string>,
}

/**
 * Theme colours an application may set, named without the '--eb-' prefix.
 *
 * Four, deliberately: a foreground, a background and two brand accents are
 * enough to make the interface belong to the application. 'primary' takes over
 * everywhere Edgeberry's own blue appears — buttons, links, headings, icons.
 * 'secondary' follows the primary unless it is set.
 *
 * Restricted to a list rather than accepting any name, so a typo is reported
 * instead of silently defining a variable nothing reads.
 */
const BRANDING_COLORS = ['fg', 'bg', 'primary', 'secondary'];

/**
 * Colour values are written into a style attribute, so they are held to a
 * conservative shape: hex, rgb()/hsl(), or a CSS colour keyword. Anything with
 * the punctuation needed to escape the declaration is refused.
 */
const COLOR_PATTERN = /^#[0-9a-fA-F]{3,8}$|^[a-zA-Z]+$|^(rgb|rgba|hsl|hsla)\([0-9a-zA-Z%.,\/\s-]+\)$/;

/**
 * Accept 'A2CA6F' as '#A2CA6F'.
 *
 * Writing a hex colour without the hash is a common enough slip that refusing
 * it is unhelpful. Only strings containing a digit are treated this way, so a
 * CSS keyword — which is all letters — is never mistaken for hex.
 */
function normalizeColor( value:string ):string{
    const trimmed = value.trim();
    return /^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$|^[0-9a-fA-F]{8}$/.test(trimmed) && /[0-9]/.test(trimmed)
        ? '#'+trimmed
        : trimmed;
}

export type ApplicationManifest = {
    name:         string,
    version?:     string,
    description?: string,
    branding?:    ApplicationBranding,
    /**
     * What the device should call itself: this, a hyphen, and the six
     * characters identifying the base board — 'Freya' gives 'Freya-a0961b'.
     *
     * A prefix rather than a whole hostname, for two reasons: two devices
     * running the same application must not claim the same name, and the
     * hostname is meant to stay the same string as the access point SSID.
     */
    hostnamePrefix?: string,
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

    if(raw.ui !== undefined)       manifest.ui       = readUi(raw.ui, file);
    if(raw.service !== undefined)  manifest.service  = readService(raw.service, file);
    if(raw.branding !== undefined) manifest.branding = readBranding(raw.branding, file, applicationPath);

    if(raw.hostnamePrefix !== undefined)
        manifest.hostnamePrefix = readHostnamePrefix(raw.hostnamePrefix, file);

    return manifest;
}

/** Image types the interface can render for a logo or a mark. */
const BRANDING_EXTENSIONS = ['.svg', '.png', '.ico', '.jpg', '.jpeg', '.webp', '.gif'];

function readBranding( branding:any, file:string, applicationPath:string ):ApplicationBranding{
    if(!branding || typeof branding !== 'object') throw new Error(`${file}: 'branding' must be an object`);

    const resolved:ApplicationBranding = {};

    for(const kind of ['logo', 'mark'] as const){
        const declared = branding[kind];
        if(declared === undefined || declared === null) continue;
        if(typeof declared !== 'string' || !declared.trim())
            throw new Error(`${file}: 'branding.${kind}' must be a path`);

        // Resolved against the application's own directory and required to stay
        // inside it. The device serves whatever this names, so it must not be a
        // way to read an arbitrary file off the disk through the web interface.
        const target = path.resolve(applicationPath, declared.trim());
        if(target !== applicationPath && !target.startsWith(applicationPath + path.sep))
            throw new Error(`${file}: 'branding.${kind}' points outside ${applicationPath}`);

        if(!BRANDING_EXTENSIONS.includes(path.extname(target).toLowerCase()))
            throw new Error(`${file}: 'branding.${kind}' must be one of ${BRANDING_EXTENSIONS.join(', ')}`);
        if(!existsSync(target))
            throw new Error(`${file}: 'branding.${kind}' does not exist (${target})`);

        resolved[kind] = target;
    }

    if(branding.colors !== undefined){
        if(!branding.colors || typeof branding.colors !== 'object' || Array.isArray(branding.colors))
            throw new Error(`${file}: 'branding.colors' must be an object`);

        const colors:Record<string,string> = {};
        for(const [token, value] of Object.entries(branding.colors)){
            if(!BRANDING_COLORS.includes(token))
                throw new Error(`${file}: 'branding.colors.${token}' is not a theme token `+
                                `(expected one of ${BRANDING_COLORS.join(', ')})`);
            if(typeof value !== 'string')
                throw new Error(`${file}: 'branding.colors.${token}' is not a colour: ${JSON.stringify(value)}`);
            const color = normalizeColor(value);
            if(!COLOR_PATTERN.test(color))
                throw new Error(`${file}: 'branding.colors.${token}' is not a colour: ${JSON.stringify(value)}`);
            colors[token] = color;
        }
        if(Object.keys(colors).length) resolved.colors = colors;
    }

    return resolved;
}

/**
 * Validate the prefix the device will build its hostname from.
 *
 * Checked here so a packager finds out at registration, which is the pattern the
 * rest of this file follows — and because nothing downstream will catch it:
 * raspi-config takes what it is given in 'nonint' mode.
 */
function readHostnamePrefix( value:any, file:string ):string{
    const prefix = typeof value === 'string' ? value.trim() : '';

    // A DNS label stops at 63 characters and the device appends a hyphen plus
    // six of its own, so the prefix has a lower ceiling than the label pattern.
    if(!HOSTNAME_LABEL.test(prefix) || prefix.length > MAX_PREFIX_LENGTH)
        throw new Error(`${file}: 'hostnamePrefix' must be letters, digits and hyphens, `+
                        `not starting or ending with a hyphen, at most ${MAX_PREFIX_LENGTH} characters`);

    return prefix;
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
function renderNginxConf( manifest:ApplicationManifest ):string{
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
        `\n` +
        `    # An application knows nothing of the prefix, so anything it hands\n` +
        `    # back as a root-relative path escapes it. Redirects and cookie\n` +
        `    # paths are the two that do: '/editor/' would land on the device's\n` +
        `    # catch-all, and a cookie scoped to '/editor' would never be sent.\n` +
        `    # Rewritten here so the application needs no knowledge of the mount.\n` +
        `    proxy_redirect    http://127.0.0.1:${manifest.ui.port}/ ${APPLICATION_PREFIX}/;\n` +
        `    proxy_redirect    /                                    ${APPLICATION_PREFIX}/;\n` +
        `    proxy_cookie_path ~^/(.*)$                             ${APPLICATION_PREFIX}/$1;\n` +
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
        // Adoption only applies when this registration actually claims routing.
        // An application that registers for branding or lifecycle alone has said
        // nothing about paths, so taking away the routes it installed by hand
        // would leave it unreachable for no reason.
        const claiming = adopt && Boolean(application?.manifest.ui);
        if(!isOurs && !claiming){
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
