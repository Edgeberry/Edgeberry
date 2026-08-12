/*
 *  Device name
 *
 *  The hostname this device answers to, in two parts: '<prefix>-<suffix>'.
 *
 *  The suffix is the first six characters of the base board's UUID, which is
 *  what makes the name this device's own. The prefix is 'EDGB' out of the box,
 *  or whatever a registered application declares for itself.
 *
 *  This is also the name the device broadcasts in AP mode. Not a matching name
 *  built from the same parts — the same string, read from here (see
 *  NetworkManager.apSsid). A device has one name, and there is no useful sense
 *  in which the thing you find in a WiFi list is called something else than the
 *  thing you find on the network.
 *
 *  Both halves are derived on every evaluation and only the result is stored.
 *  That is what makes the two changes worth following work without a case each:
 *  replacing the base board moves the suffix, registering or updating an
 *  application moves the prefix, and neither is a special path through here.
 *
 *  Edgeberry names the device only while the name on the device is still the
 *  name Edgeberry gave it. Rename it by hand and it stops, permanently — a
 *  device that renames itself back under its owner is worse than one that never
 *  renamed itself at all. That is recorded in settings.json, because it has to
 *  survive the restart that would otherwise take the name back.
 */

import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import os from 'os';

import { board_deviceName, board_getShortId, board_getUUID } from './board';
import { HostnameRecord, settings_getHostname, settings_storeHostname } from './settingsStore';

/** What the device calls itself with no application registered. */
const DEFAULT_PREFIX = 'EDGB';

/**
 * An RFC 1123 label: letters, digits and hyphens, not starting or ending with
 * one, at most 63 characters.
 *
 * This is the only validation there is. raspi-config shows its RFC warning to
 * interactive users only and takes '$1' verbatim in 'nonint' mode, straight into
 * a sed expression — so nothing downstream is going to catch a bad name.
 */
export const HOSTNAME_LABEL = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

/**
 * Longest prefix that still leaves room for '-' and the six-character suffix.
 *
 * 25, not the 56 a DNS label would allow, because the device broadcasts this
 * same name as its access point SSID and an SSID stops at 32 bytes. The tighter
 * of the two limits is the one that keeps the device's two names identical,
 * which is the point of building them from one place — so it is enforced when
 * the manifest is read, rather than discovered later as an access point that
 * quietly calls itself something else.
 */
export const MAX_PREFIX_LENGTH = 25;

/**
 * Names an unconfigured image carries, which nobody chose.
 *
 * Only consulted on a device with no ownership record at all — in practice the
 * first start after installation. See isClaimable().
 */
const STOCK_NAMES = ['raspberrypi', 'raspberry', 'debian', 'localhost', 'edgeberry'];

/** The shape of every name this device software generates: prefix, six hex. */
const GENERATED = /^[A-Za-z0-9]+-[0-9a-fA-F]{6}$/;

/*
 *  Reading the current name
 */

/**
 * The static hostname — what the device is called, rather than what it happens
 * to be answering to right now.
 *
 * The two differ when something (a DHCP lease, most often) has set a transient
 * hostname on top. The static name is the one Edgeberry sets and therefore the
 * one that ownership is judged against, so os.hostname() is the wrong question
 * and only stands in when /etc/hostname cannot be read at all.
 */
export function hostname_current():string{
    try{
        return readFileSync('/etc/hostname', 'utf8').trim();
    } catch(_err){
        return os.hostname();
    }
}

/** Whether the device name is currently Edgeberry's to set. */
export function hostname_isManaged():boolean{
    const record = settings_getHostname();
    return Boolean(record?.managed) && record?.managed === hostname_current();
}

/**
 * Take the device name over, whatever it is now.
 *
 * The way back from a released record, and it has to ignore both of the guards
 * that hostname_apply() respects — not just the released flag. Clearing the
 * record alone would leave isClaimable() to judge a name it has no history for,
 * and that name is by definition one a person chose, so it would be handed
 * straight back. An escape hatch that re-releases is not one.
 *
 * Only reached from the CLI, where somebody has said this device should be
 * Edgeberry's to name again.
 */
export function hostname_claim( prefix:string|null ):void{
    try{
        decide(prefix, true);
    } catch(err:any){
        console.error('\x1b[31mCould not claim the device name: '+err.message+'\x1b[37m');
    }
}

/*
 *  Deciding
 */

/**
 * Whether a name Edgeberry has no record of is one it may take over.
 *
 * This runs only when there is no ownership record — the first start after
 * installation, or after settings.json was lost. It is frankly a guess about
 * history we do not have, and it errs towards leaving names alone: a device
 * someone called 'greenhouse-3' before this feature existed keeps that name, and
 * 'edgeberry --hostname auto' is how it gets renamed if that was not wanted.
 */
function isClaimable( current:string ):boolean{
    if(!current || STOCK_NAMES.includes(current.toLowerCase())) return true;

    // Any prefix on any six hex characters is a name we generated: an earlier
    // release of this software, a previous application's prefix, or — the case
    // that matters — the base board that was on this header before the one that
    // is on it now. Matching the shape rather than today's exact suffix is what
    // lets a board swap be recognised as ours rather than as somebody's choice.
    return GENERATED.test(current);
}

/**
 * Make the device name match the given prefix, or leave it alone and say why.
 *
 * Never throws: this runs from registry_load() on the startup path, where an
 * exception would skip everything after it — including connecting to the Device
 * Hub. Naming the device is cosmetic; that is not.
 */
export function hostname_apply( prefix:string|null ):void{
    try{
        decide(prefix, false);
    } catch(err:any){
        console.error('\x1b[31mCould not set the device name: '+err.message+'\x1b[37m');
    }
}

/** `claimed` is somebody overriding both ownership guards on purpose. */
function decide( prefix:string|null, claimed:boolean ):void{
    const uuid   = board_getUUID();
    const suffix = board_getShortId();
    // No base board, no suffix, nothing to name the device after. The same rule
    // the access point follows: a device without a HAT is not one we can name.
    if(!uuid || !suffix) return;

    const desired = board_deviceName(prefix || DEFAULT_PREFIX, uuid);
    const current = hostname_current();
    const record  = settings_getHostname();

    // Released once is released forever — unless somebody claims it back. The
    // record is what stops this being re-decided, and re-taken, on every start.
    if(record?.released && !claimed) return;

    /*
     *  Ownership asks 'is this still the name we set?', never 'is this the name
     *  we would set now?'. The second question would refuse to follow a replaced
     *  base board or an application that renamed itself, which are precisely the
     *  changes this is meant to follow.
     */
    const ours = claimed || (record?.managed ? record.managed === current : isClaimable(current));
    if(!ours){
        console.log('\x1b[33mDevice name \''+current+'\' was set by hand; '+
                    'Edgeberry leaves it alone from here on\x1b[37m');
        settings_storeHostname({ released: current });
        return;
    }

    if(current !== desired){
        const replaced = record?.uuid && record.uuid !== suffix;
        console.log('\x1b[33mDevice name: '+current+' -> '+desired+
                    (replaced ? ' (base board replaced: '+record.uuid+' -> '+suffix+')' : '')+
                    '\x1b[37m');
        setSystemHostname(desired);
    }

    // Recorded even when the name did not change, because a first start has no
    // record at all and without one the next start would have to guess again.
    // Guarded so an unchanged decision is not an SD card write on every boot.
    const settled:HostnameRecord = { managed: desired, uuid: suffix };
    if(record?.managed !== settled.managed || record?.uuid !== settled.uuid)
        settings_storeHostname(settled);
}

/*
 *  Setting
 */

/**
 * Rename the device, through raspi-config.
 *
 * Not through org.freedesktop.hostname1, which would fit this codebase better —
 * see the note in dbusInterface.ts for why. In short: hostname1 owns
 * /etc/hostname and nobody owns /etc/hosts, and on Raspberry Pi OS the second
 * one is what makes a device able to resolve its own name. raspi-config runs
 * hostnamectl itself *and* repairs /etc/hosts, so this delegates to the
 * platform's own tool rather than hand-editing a file that leaves the device
 * unresolvable when it is written wrong.
 */
function setSystemHostname( name:string ):void{
    // Refused rather than passed on: 'nonint' mode drops this argument into a
    // sed expression unchecked. Argument array, never a shell string.
    if(!HOSTNAME_LABEL.test(name))
        throw new Error('refusing to set an invalid hostname: '+name);

    const result = spawnSync('raspi-config', ['nonint', 'do_hostname', name], { encoding: 'utf8' });

    if(result.error){
        // Absent on plain Debian, present on every Raspberry Pi OS image — and
        // Edgeberry is a Pi HAT, so in practice this is a development machine.
        // Worth its own message rather than a spawn error nobody can act on.
        if((result.error as NodeJS.ErrnoException).code === 'ENOENT')
            throw new Error('raspi-config is not installed; leaving the device name as it is');
        throw new Error('raspi-config could not be run: '+result.error.message);
    }
    if(result.status !== 0)
        throw new Error('raspi-config exited '+result.status+': '+
                        (result.stderr || result.stdout || '').trim());

    // Checked rather than believed. do_hostname sends hostnamectl's stderr to
    // /dev/null and ends on an assignment, so its exit status is 0 whether the
    // rename happened or not — and the caller is about to record this name as
    // the one it set.
    const settled = hostname_current();
    if(settled !== name)
        throw new Error('raspi-config reported success, but the hostname is still \''+settled+'\'');

    verifyHostsEntry(name);
}

/**
 * Check that the device can still resolve its own name, and complain loudly if
 * it cannot.
 *
 * raspi-config rewrites /etc/hosts with a sed keyed on the *previous* hostname.
 * If that '127.0.1.1' line was missing, or named something else, the sed matched
 * nothing and quietly changed nothing.
 *
 * That is not cosmetic. Raspberry Pi OS ships
 * 'hosts: files mdns4_minimal [NOTFOUND=return] dns' — no 'myhostname' to
 * synthesise an answer the way Ubuntu's nsswitch.conf does — so /etc/hosts is
 * the only thing that resolves the machine's own name. Without it every sudo
 * prints a warning, and anything looking itself up waits for DNS to fail first.
 *
 * Reported rather than repaired: writing this file is what we delegated to
 * raspi-config to avoid, and a device that says why it is unresolvable is more
 * use than one that silently half-fixes it.
 */
function verifyHostsEntry( name:string ):void{
    try{
        const resolves = readFileSync('/etc/hosts', 'utf8').split('\n').some( line =>
            /^\s*127\.0\.1\.1\s/.test(line) && line.trim().split(/\s+/).slice(1).includes(name));

        if(!resolves)
            console.error('\x1b[31m/etc/hosts has no 127.0.1.1 entry for \''+name+
                          '\': this device cannot resolve its own name\x1b[37m');
    } catch(_err){
        // An unreadable /etc/hosts is not a reason to undo a rename that worked.
    }
}
