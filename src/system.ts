/*
 *  System
 *  Interaction with system-related features.
 */
import { exec, execSync } from "child_process";
import { stateManager } from ".";
import pm2 from 'pm2';
import { readFileSync } from "fs";


/*
 *  Edgeberry Hardware
 *  The Edgeberry is a Raspberry Pi 'hat', with an on-board EEPROM that's flashed
 *  with info and settings. Information about the vendor and the product are found
 *  in the filesystem under the device tree '/proc/device-tree/hat'
 */
const system_board_rootFolder = '/proc/device-tree/hat'

// Get the board vendor
// The product vendor is a string
export function system_board_getVendor(){
    try{
        const value = readFileSync(system_board_rootFolder+'/vendor').toString().replace(/\0.*$/g,'');
        return value;
    } catch(err){
        return null;
    }
}

// Get the product name
// The product name is a string
export function system_board_getProductName(){
    try{
        const value = readFileSync(system_board_rootFolder+'/product').toString().replace(/\0.*$/g,'');
        return value;
    } catch(err){
        return null;
    }
}

// Get the product ID
// The hat's product_id is 2-bytes
export function system_board_getProductId(){
    try{
        const value = readFileSync(system_board_rootFolder+'/product_id').toString();
        return value;
    } catch(err){
        return null;
    }
}

// Get the product version
// The hat's product_ver is 2 bytes. the first byte representing the
// major version number, the second byte the minor version number (e.g. 0x0104)
// We'll decode it to a string (e.g. "1.4")
export function system_board_getProductVersion(){
    try{
        // the return value is, for example, "0x0102", we only want everything after the 'x'
        const value = readFileSync(system_board_rootFolder+'/product_ver').toString().split('x')[1];
        // convert to buffer of hexadecimal bytes
        const buffer = Buffer.from(value, 'hex');
        // first byte is te major number
        const majorNumber = buffer.readIntBE(0, 1);
        // second byte is te minor number
        const minorNumber = buffer.readIntLE(1, 1);
        // return as a formatted version string
        return majorNumber+'.'+minorNumber;
    } catch(err){
        return null;
    }
}

// Get the board's UUID
// RFC4122 compliant UUID
export function system_board_getUUID(){
    try{
        const value = readFileSync(system_board_rootFolder+'/uuid').toString().replace(/\0.*$/g,'');
        return value;
    } catch(err){
        return null;
    }
}

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
export function system_restart( timeoutMs?:number ){
    stateManager.updateSystemState('state', 'restarting');
    try{
        if( typeof(timeoutMs) !== 'number' ){
            // Reboot Now
            setTimeout(()=>{exec(`shutdown -r now`)},1000);
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
// Using PM2
export function system_getApplicationInfo():Promise<string|any>{
    return new Promise<string|any>((resolve, reject)=>{
        pm2.connect((err:any)=>{
            if (err) return reject(err.toString());
            pm2.list((err:any, processes:any) => {
                if (err) return reject(err);
                // Loop through processes
                processes.forEach((process:any) => {
                    if(process.name === 'EdgeBerry'){
                        try{
                            var packageJson = JSON.parse(readFileSync('/opt/EdgeBerry/package.json').toString());
                        }
                        catch(err){
                            packageJson = {}
                        }
                        const data = {
                            name: packageJson?.name,
                            version: packageJson?.version,
                            cpuUsage: process.monit.cpu+'%',
                            memUsage: Math.round(parseInt(process.monit.memory)/100000)+' MB',
                            status: process.pm2_env.status
                        }
                        pm2.disconnect();
                        return resolve( data );
                    }
                });
                pm2.disconnect();
                return reject("Process for 'EdgeBerry' not found");
            });
        })
    });
}

// Update system application
export function system_updateApplication():Promise<string>{
    return new Promise<string>((resolve, reject)=>{
        stateManager.updateSystemState('state','updating');
        try{
            const URL = "https://github.com/SpuQ/EdgeBerry/archive/refs/heads/main.tar.gz"
            const TMPDIR = "/tmp/EdgeBerry"
            const APPNAME = "EdgeBerry"

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