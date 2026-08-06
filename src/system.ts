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
import path from "path";
import type { SystemState } from "./stateManager";

/*
 *  Reporting system state upwards
 *
 *  Power and update operations change the device's lifecycle state, and the
 *  status LED has to follow. This module used to import the StateManager
 *  singleton from main.ts to do that, which made main.ts depend on this module
 *  and this module depend on main.ts — a cycle that forced other modules into
 *  lazy require() calls to work around it.
 *
 *  The dependency is inverted instead: the composition root supplies a
 *  reporting function. Until it does, reports are discarded, which keeps this
 *  module importable on its own.
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
                // Resolve relative to this module rather than an absolute
                // install path: the previous '/opt/Edgeberry/package.json' is
                // one directory too high — the file lives in the component
                // directory (/opt/Edgeberry/Core) — so this always threw and
                // the device reported its version as 'unknown'. Going through
                // __dirname also keeps `npm run dev` working from src/.
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
