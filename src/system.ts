/*
 *  System
 *  The Linux host the device software runs on: its platform, its power state,
 *  and this application's own identity and update path.
 *
 *  Anything belonging to the Edgeberry HAT — identity EEPROM, status LED,
 *  buzzer, user button — lives in board.ts. The two are separate machines and
 *  change for separate reasons.
 */
import { exec, execSync } from "child_process";
import { readFileSync } from "fs";
import os from "os";
import path from "path";
import type { SystemState } from "./stateManager";

/*
 *  Reporting system state upwards
 *
 *  Power and update operations change the device's lifecycle state, and the
 *  status LED has to follow. The dependency is inverted rather than imported:
 *  the composition root supplies a reporting function, and until it does,
 *  reports are discarded. That keeps this module importable on its own, and
 *  keeps it out of an import cycle with main.ts.
 */
let reportSystemState: (state: SystemState) => void = () => {};

export function setSystemStateReporter( report:(state:SystemState)=> void ):void{
    reportSystemState = report;
}

/*
 *  Networking lives in networkManager.ts, which reads NetworkManager over
 *  D-Bus. This module briefly carried a second implementation built on iwgetid
 *  and ifconfig; the two could disagree, and only this one could be wrong.
 */

/*
 *  Power
 *  Shutdown, reboot, ...
 */

// Reboot the system
export function system_restart( timeoutMs?:number ){
    reportSystemState('rebooting');
    try{
        if( typeof(timeoutMs) !== 'number' ){
            // Reboot Now
            setTimeout(()=>{exec(`shutdown -r now`)},1500);
        }
        else{
            // Reboot after timeout 
            setTimeout(()=>{exec(`shutdown -r now`)},timeoutMs);
        }
        return true;
    } catch(err){
        return 'Error: '+err;
    }
}

// Shut down the system
export function system_shutdown( timeoutMs?:number ){
    reportSystemState('rebooting');
    try{
        const delay = typeof timeoutMs === 'number' ? timeoutMs : 1500;
        setTimeout(()=>{ exec(`shutdown -h now`); }, delay);
        return true;
    } catch(err){
        return 'Error: '+err;
    }
}

/*
 *  System information
 *
 *  What the device name in the top bar opens: the machine this software runs
 *  on, its operating system, and how much of it is in use.
 *
 *  Everything that cannot change while the process runs — model, serial, CPU,
 *  OS release — is read once and kept, so opening the panel repeatedly costs
 *  nothing but the three live figures. Nothing here throws: an unreadable
 *  source becomes null and the web interface leaves that row out, because a
 *  missing serial number is not a reason to fail the whole panel.
 */

export type SystemInfo = {
    hostname:     string;
    /** e.g. 'Raspberry Pi 5 Model B Rev 1.0' */
    model:        string|null;
    /** Machine serial, not the Edgeberry board's UUID. */
    serial:       string|null;
    /** e.g. 'Debian GNU/Linux 12 (bookworm)' */
    osName:       string|null;
    kernel:       string;
    architecture: string;
    /** e.g. 'Cortex-A76' */
    cpu:          string|null;
    cpuCores:     number;
    memoryTotal:  number;           // bytes
    memoryFree:   number;           // bytes
    diskTotal:    number|null;      // bytes, root filesystem
    diskFree:     number|null;      // bytes, root filesystem
    uptime:       number;           // seconds
    /** Version of this application. */
    version:      string|null;
};

/** Read a devicetree/sysfs string, which is NUL-terminated. */
function readDeviceTreeString( file:string ):string|null{
    try{
        return readFileSync(file).toString().replace(/\0.*$/g,'').trim() || null;
    } catch(err){
        return null;
    }
}

/** PRETTY_NAME out of /etc/os-release — the name the distribution calls itself. */
function readOsName():string|null{
    try{
        const line = readFileSync('/etc/os-release').toString()
                        .split('\n')
                        .find( line => line.startsWith('PRETTY_NAME=') );
        if( !line ) return null;
        return line.slice('PRETTY_NAME='.length).replace(/^"|"$/g,'') || null;
    } catch(err){
        return null;
    }
}

/** The board serial the SoC reports. Absent on hardware that has no such field. */
function readSerial():string|null{
    try{
        const line = readFileSync('/proc/cpuinfo').toString()
                        .split('\n')
                        .find( line => line.startsWith('Serial') );
        return line ? (line.split(':')[1]?.trim() || null) : null;
    } catch(err){
        return null;
    }
}

/** The version in this application's own package.json. */
function readOwnVersion():string|null{
    try{
        const packageJson = JSON.parse(readFileSync(path.join(__dirname,'..','package.json')).toString());
        return packageJson?.version ?? null;
    } catch(err){
        return null;
    }
}

/** Size and free space of the root filesystem, in bytes. */
function readRootFilesystem():{ total:number|null; free:number|null }{
    try{
        // --output keeps the columns predictable; plain `df` output shifts with
        // the filesystem name length.
        const line = execSync('df -B1 --output=size,avail / 2>/dev/null').toString().split('\n')[1] ?? '';
        const [ size, avail ] = line.trim().split(/\s+/).map(Number);
        if( !Number.isFinite(size) || !Number.isFinite(avail) ) return { total: null, free: null };
        return { total: size, free: avail };
    } catch(err){
        return { total: null, free: null };
    }
}

// Read once: these describe the machine, and the machine does not change
// underneath a running process.
let staticInfo: Pick<SystemInfo,'model'|'serial'|'osName'|'kernel'|'architecture'|'cpu'|'cpuCores'|'version'> | null = null;

export function system_getInfo():SystemInfo{
    if( !staticInfo ){
        const cpus = os.cpus();
        staticInfo = {
            model:        readDeviceTreeString('/proc/device-tree/model'),
            serial:       readSerial(),
            osName:       readOsName(),
            kernel:       os.release(),
            // os.machine() is the uname string ('aarch64'), which is what the
            // rest of the system reports; os.arch() is Node's own naming.
            architecture: os.machine(),
            cpu:          cpus[0]?.model ?? null,
            cpuCores:     cpus.length,
            version:      readOwnVersion(),
        };
    }

    const disk = readRootFilesystem();

    return {
        ...staticInfo,
        hostname:    os.hostname(),
        memoryTotal: os.totalmem(),
        memoryFree:  os.freemem(),
        diskTotal:   disk.total,
        diskFree:    disk.free,
        uptime:      os.uptime(),
    };
}

// Get the Raspberry Pi hardware version
export async function system_getPlatform(){
    try{
        const piVersion = execSync(`cat /proc/device-tree/model 2>/dev/null`).toString().replace(/\0.*$/g,'');
        return piVersion;
    } catch(err){
        try{
            const system = execSync(`hostnamectl | grep -E 'Hardware Vendor|Hardware Model' | awk '{printf "%s %s", $3, $4}'`).toString();
            return system;
        }
        catch(err){}
        return 'Error';
    }
}

/*
 *  System Application
 *  Basically this app
 */

// Get system application info
export function system_getApplicationInfo():Promise<string|any>{
    return new Promise<string|any>((resolve, reject)=>{
        try{
                // Resolved relative to this module rather than an absolute
                // install path: the file lives in the component directory
                // (/opt/Edgeberry/Core), and going through __dirname also keeps
                // `npm run dev` working from src/.
                var packageJson = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json')).toString());
            }
        catch(err){
            packageJson = {}
        }

        const data = {
                            name: packageJson?.name,
                            version: packageJson?.version,
                            cpuUsage: 'unknown',
                            memUsage: 'unknown',    // TODO
                            status: 'unknown'
                        }
        return resolve( data );
    });
}

// Update system application
export function system_updateApplication():Promise<string>{
    return new Promise<string>((resolve, reject)=>{
        reportSystemState('updating');
        try{
            const URL = "https://github.com/Edgeberry/Edgeberry/archive/refs/heads/main.tar.gz"
            const TMPDIR = "/tmp/Edgeberry"
            const APPNAME = "Edgeberry"

            exec(`
                        mkdir -p ${TMPDIR}
                        wget -O ${TMPDIR}/${APPNAME}.tar.gz ${URL}
                        if [ $? -ne 0 ]; then
                            echo "Download failed, exit."
                            exit 1;
                        fi
                        tar -zxf ${TMPDIR}/${APPNAME}.tar.gz --directory /opt/${APPNAME} --strip-components 1
                        if [$? -ne 0 ]; then
                            echo "Untar failed, exit."
                            exit 1;
                        fi
                        cd /opt/${APPNAME}
                        npm install --save-dev
                        npm run build
                        rm -rf ${TMPDIR}
                        #pm2 restart $APPNAME
                        exit 0;
            `,(err)=>{
                if(err) return reject('Error: '+err);
                // Restart system application and resolve
                reportSystemState('restarting');
                setTimeout(()=>{resolve('Application updated, restarting now')});
                setTimeout(()=>{exec(`pm2 restart ${APPNAME}`)},1000);
            });
        } catch(err){
            return reject('Error: '+err);
        }
    });
}
