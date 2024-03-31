/*
 *  System
 *  Interaction with system-related features.
 */
import { exec, execSync } from "child_process";
import { readFileSync } from "fs";
const pm2 = require('pm2');

/*
 *  Networking
 *  Everything related to the networking interfaces
 */

// Get the SSID of the current WLAN connection
export async function system_getWirelessSSID(){
    try{
        const ssid = execSync(`iwgetid | awk -F '"' '{print $2}' 2>/dev/null` ).toString().split('\n')[0];
        return ssid;
    } catch(err){
        return 'Error: '+err;
    }
}

// Get the IP address of the WLAN connection
export async function system_getWirelessAddress( networkInterface:string ){
    try{
        const ipAddress = execSync(`ifconfig ${networkInterface} | awk -F ' *|:' '/inet /{print $3}' 2>/dev/null`).toString().split('\n')[0];
        return ipAddress;
    } catch(err){
        return 'Error: '+err;
    }
}


/*
 *  Power
 *  Shutdown, reboot, ...
 */

// Reboot the system
export async function system_restart( timeoutMs?:number ){
    try{
        if(!timeoutMs){
            // Reboot Now
            execSync(`shutdown -r now`);
        }
        else{
            // Reboot after timeout 
            setTimeout(()=>{exec(`shutdown -r now`)},timeoutMs);
        }
        return '';
    } catch(err){
        return 'Error: '+err;
    }
}

/*
 *  System Application
 *  Basically this app
 */

// Get system application info
export function system_getApplicationInfo():Promise<string|any>{
    return new Promise<string|any>((resolve, reject)=>{
        pm2.connect((err:any)=>{
            if (err) {
              return reject(err.toString());
            }
          
            pm2.list((err:any, processes:any) => {
                if (err) {
                    return reject(err);
                }
          
                // Loop through processes
                processes.forEach((process:any) => {
                    if(process.name === 'Edge_Gateway'){
                        const data = {
                            version: process.pm2_env.version,
                            cpuUsage: process.monit.cpu+'%',
                            memUsage: process.monit.memory+'MB',
                            status: process.pm2_env.status
                        }
                        pm2.disconnect();
                        resolve( data );
                    }
                });
                pm2.disconnect();
            });
        })
    });
}

// Update system application
export function system_updateApplication():Promise<string>{
    return new Promise<string>((resolve, reject)=>{
        try{
            const URL = "https://github.com/SpuQ/Edge_Gateway/archive/refs/heads/main.tar.gz"
            const TOKEN = "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"
            const TMPDIR = "/tmp/Edge_Gateway"
            const APPNAME = "Edge_Gateway"

            exec(`
                        mkdir -p ${TMPDIR}
                        wget --header="Authorization: token ${TOKEN}" -O ${TMPDIR}/${APPNAME}.tar.gz ${URL}
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
                setTimeout(()=>{exec(`pm2 restart ${APPNAME}`)},1000);
                return resolve('Application updated, restarting now');
            });
        } catch(err){
            return reject('Error: '+err);
        }
    });
}

/*
 *  Hardware
 *  Hardware features connected to the I/O of the Linux system;
 *  a buzzer and a LED. 'Cause everything is better with a buzzer
 *  and a LED connected to it. In the end, us electronics engineers,
 *  we do it for the "tsjeeptsjeep" and the "bleepbleep", right?
 */


// For the blinking logic
let primary:boolean=true;
let blinkInterval:any = null;

// Set Status indication on the LED
export function system_setStatusLed( color:string, blink?:boolean|number, secondaryColor?:string ){
    // Clear the previous state
    if( blinkInterval ) clearInterval( blinkInterval );
    primary=true;
    setLedColor('off');

    // Static color
    if( typeof(blink) === 'undefined' || (typeof(blink) === 'boolean' && blink === false) )
    return setLedColor( color );

    // Blinking colors
    blinkInterval = setInterval(()=>{
        if( primary ){
            setLedColor( color );
        }
        else{
            setLedColor( secondaryColor?secondaryColor:'off' );
        }
        // Toggle
        primary = !primary;

    }, (typeof(blink)==='number'?blink:600));
}

// Set status indication on the buzzer
// long | short | twice
export function system_beepBuzzer( status:string ){
    switch(status){
        // Short beep
        case 'short':   setTimeout(()=>{setBuzzerState('off')},80);
                        setBuzzerState('on');
                        break;
        // Long beep
        case 'long':    setTimeout(()=>{setBuzzerState('off')},200);
                        setBuzzerState('on');
                        break;
        case 'twice':   break;

        // Turn buzzer off
        default:        setBuzzerState('off');
                        break;
    }
}


/*
 *  Actual hardware controlling functions
 */

async function initialize(){
    try{
        // The status LED has 2 colors on seperate IO pins
        // initialize the green LED (gpio26) as digital output (and digital low)
        execSync('pinctrl set 26 op dl >/dev/null 2>&1');
        // initialize the red LED (gpio19) as digital output (and digital low)
        execSync('pinctrl set 19 op dl >/dev/null 2>&1');

        // initialize the buzzer (gpio5) as digital output (and digital low)
        execSync('pinctrl set 5 op dl >/dev/null 2>&1');
    } catch (err){
        console.error('\x1b[31mStatus indicators not inititialized!\x1b[37m');
    }
}

// Initialize
initialize();

// Set the color of the LED
function setLedColor( color:string ){
    try{
        switch( color ){
            // Red
            case 'red':     execSync('pinctrl set 26 dl >/dev/null 2>&1');
                            execSync('pinctrl set 19 dh >/dev/null 2>&1');
                            break;
            // Green
            case 'green':   execSync('pinctrl set 26 dh >/dev/null 2>&1');
                            execSync('pinctrl set 19 dl >/dev/null 2>&1');
                            break;
            // Orange
            case 'orange':  execSync('pinctrl set 26 dh >/dev/null 2>&1');
                            execSync('pinctrl set 19 dh >/dev/null 2>&1');
                            break;
            // Off (for anything else)
            default:        execSync('pinctrl set 26 dl >/dev/null 2>&1');
                            execSync('pinctrl set 19 dl >/dev/null 2>&1');
                            break;
        }
    } catch(err){
        // Todo: do something with this error
    }
}

// Set the buzzer on/off
function setBuzzerState( state:string ){
    try{
        switch( state ){
            // On
            case 'on':  execSync('pinctrl set 5 dh >/dev/null 2>&1');
                        break;
            // Off (for anything else)
            default:    execSync('pinctrl set 5 dl >/dev/null 2>&1');
                        break;
        }
    } catch(err){
        // Todo: do something with this error
    }
}