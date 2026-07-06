/*
 *  System
 *  Interaction with system-related features.
 */
import { exec, execSync } from "child_process";
import { stateManager } from "./main";
import { readFileSync } from "fs";
import { EventEmitter } from "stream";

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
    stateManager.updateSystemState('state', 'rebooting');
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
                var packageJson = JSON.parse(readFileSync('/opt/Edgeberry/package.json').toString());
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
        stateManager.updateSystemState('state','updating');
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
                stateManager.updateSystemState('state','restarting');
                setTimeout(()=>{resolve('Application updated, restarting now')});
                setTimeout(()=>{exec(`pm2 restart ${APPNAME}`)},1000);
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
let blinkInterval:ReturnType<typeof setInterval> | null = null;
// All in-flight setTimeout handles from blinkTwice/blinkThrice chains.
// Cleared at the top of system_setStatusLed so a new command never races
// against an orphaned write from the previous pattern.
const pendingBlinkTimeouts: ReturnType<typeof setTimeout>[] = [];

// Last-applied LED command — used by the idempotency guard to avoid
// restarting a pattern (and resetting blink phase) when the same command
// is issued again by a chatty state stream.
let lastLedColor: string = '';
let lastLedBlink: boolean | number | undefined = undefined;
let lastLedSecondary: string | undefined = undefined;
let lastLedDoubleblink: boolean | undefined = undefined;
let lastLedTripleblink: boolean | undefined = undefined;

// Set Status indication on the LED
export function system_setStatusLed( color:string, blink?:boolean|number, secondaryColor?:string, doubleblink?:boolean, tripleblink?:boolean ){
    // Idempotency guard: if the requested command is identical to what is
    // already running, do nothing — prevents blink-phase resets under chatty
    // state updates (e.g. application.version changes that don't affect LED).
    if( color === lastLedColor &&
        blink === lastLedBlink &&
        secondaryColor === lastLedSecondary &&
        doubleblink === lastLedDoubleblink &&
        tripleblink === lastLedTripleblink ){
        return;
    }
    // Record the new command before any async work so re-entrant calls see it.
    lastLedColor       = color;
    lastLedBlink       = blink;
    lastLedSecondary   = secondaryColor;
    lastLedDoubleblink = doubleblink;
    lastLedTripleblink = tripleblink;

    // Clear all previous state: interval AND all in-flight blink-chain timeouts.
    if( blinkInterval ) clearInterval( blinkInterval );
    blinkInterval = null;
    let t: ReturnType<typeof setTimeout> | undefined;
    while( (t = pendingBlinkTimeouts.pop()) !== undefined ) clearTimeout(t);
    primary=true;
    setLedColor('off');

    // Static color
    if( typeof(blink) === 'undefined' || (typeof(blink) === 'boolean' && blink === false) )
    return setLedColor( color );

    if(tripleblink){
        // Blink three times in bursts (AP mode pattern)
        blinkThrice( color );
        blinkInterval = setInterval(()=>{
            blinkThrice( color );
        },1800);
    }
    else if(!doubleblink){
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
    else{
        // Blink two colors after each other
        blinkTwice( color, secondaryColor?secondaryColor:'red' );
        blinkInterval = setInterval(()=>{
            blinkTwice( color, secondaryColor?secondaryColor:'red' );
        },1400);
    }
}

function blinkTwice(color:string, secondaryColor:string){
    setLedColor(color);
    pendingBlinkTimeouts.push(setTimeout(()=>{
        setLedColor('off');
        pendingBlinkTimeouts.push(setTimeout(()=>{
            setLedColor(secondaryColor?secondaryColor:'red');
            pendingBlinkTimeouts.push(setTimeout(()=>{
                setLedColor('off');
            },90));
        },150));
    },90));
}

function blinkThrice(color:string){
    setLedColor(color);
    pendingBlinkTimeouts.push(setTimeout(()=>{
        setLedColor('off');
        pendingBlinkTimeouts.push(setTimeout(()=>{
            setLedColor(color);
            pendingBlinkTimeouts.push(setTimeout(()=>{
                setLedColor('off');
                pendingBlinkTimeouts.push(setTimeout(()=>{
                    setLedColor(color);
                    pendingBlinkTimeouts.push(setTimeout(()=>{
                        setLedColor('off');
                    },90));
                },90));
            },90));
        },90));
    },90));
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
        // Two short beeps
        case 'twice':   setBuzzerState('on');
                        setTimeout(()=>{ setBuzzerState('off'); },80);
                        setTimeout(()=>{ setBuzzerState('on');  },150);
                        setTimeout(()=>{ setBuzzerState('off'); },230);
                        break;

        // Turn buzzer off
        default:        setBuzzerState('off');
                        break;
    }
}


/*
 *  Named indicator presets
 *
 *  Single source of truth mapping pattern-name → concrete LED/buzzer behaviour.
 *  Use these in StateManager and direct-method handlers instead of raw positional
 *  system_setStatusLed(...) calls so intent is readable and patterns stay distinct.
 *
 *  Pattern vocabulary (before → after for changed patterns):
 *   showBooting    : orange slow blink (500 ms)       — was: constant/blink red
 *   showRestarting : orange medium blink (200 ms)     — unchanged
 *   showUpdating   : orange/red rapid alternating     — unchanged
 *   showRebooting  : orange/red blink (400 ms)        — was: constant red (fatal convention inverted)
 *   showFatal      : constant red                     — now reserved for fatal/unrecoverable only
 *   showNetworkDown: red blink 500 ms                 — was: 300 ms (clash with hub-loss)
 *   showHubLost    : red blink 300 ms                 — was: 600 ms (clash with fatal default)
 *   showApMode     : orange triple-blink burst        — unchanged
 *   showConnecting : orange/green rapid alternating   — unchanged
 *   showHealthOk   : green double-blink heartbeat     — unchanged
 *   showHealthWarn : green/orange double-blink        — unchanged
 *   showCritical   : red fast blink 150 ms + beep 1s  — unchanged
 *   showEmergency  : red very fast blink 60 ms + beep 250ms — unchanged
 *   showUnprovisioned : orange slow blink (600 ms)    — was: (no branch, kept previous light)
 *   showProvisioning  : orange rapid blink (70 ms)    — unchanged
 *   showIdentify   : green/red 40 ms + triple beep    — unchanged
 *   showApError    : red 60 ms + triple beep           — unchanged
 *   showLink       : green fast blink + beep           — unchanged
 */

export function showBooting():    void { system_setStatusLed('orange', 500); }
export function showRestarting(): void { system_setStatusLed('orange', 200); }
export function showUpdating():   void { system_setStatusLed('orange', 70, 'red'); }
export function showRebooting():  void { system_setStatusLed('orange', 400, 'red'); }
export function showFatal():      void { system_setStatusLed('red'); }
export function showNetworkDown():void { system_setStatusLed('red', 500); }
export function showHubLost():    void { system_setStatusLed('red', 300); }
export function showApMode():     void { system_setStatusLed('orange', true, undefined, undefined, true); }
export function showConnecting(): void { system_setStatusLed('orange', 70, 'green'); }
export function showHealthOk():   void { system_setStatusLed('green', true, 'green', true); }
export function showHealthWarn(): void { system_setStatusLed('green', true, 'orange', true); }
export function showCritical():   void { system_setStatusLed('red', 150); }
export function showEmergency():  void { system_setStatusLed('red', 60); }
export function showHealthUnknown(): void { system_setStatusLed('green', true, 'red', true); }
export function showUnprovisioned(): void { system_setStatusLed('orange', 600); }
export function showProvisioning():  void { system_setStatusLed('orange', 70); }

export function showIdentify(): void {
    system_setStatusLed('green', 40, 'red');
    system_beepBuzzer('short');
    setTimeout(()=>{ system_beepBuzzer('short'); }, 110);
    setTimeout(()=>{ system_beepBuzzer('short'); }, 220);
}
export function showApError(): void {
    system_setStatusLed('red', 60);
    system_beepBuzzer('short');
    setTimeout(()=>{ system_beepBuzzer('short'); }, 150);
    setTimeout(()=>{ system_beepBuzzer('short'); }, 300);
}
export function showLink(): void {
    system_beepBuzzer('short');
    system_setStatusLed('green', 40);
}

/*
 *  GPIO abstraction
 *
 *  A thin seam so the LED/buzzer transport can be swapped without touching
 *  blink logic. The PinctrlBackend retains execSync/pinctrl as the transport
 *  (unchanged behaviour) but:
 *   - Caches each pin's current level and skips the write when unchanged.
 *   - Accepts an atomic multi-pin write so both LED pins change together.
 *
 *  DEFERRED: A non-blocking libgpiod/character-device backend that holds line
 *  handles open for the process lifetime (eliminating process-spawn overhead
 *  on every blink toggle) should replace this before the next hardware
 *  revision. It requires bench verification on the Pi CM.
 *  ASSUMPTION: gpio26 = green side, gpio19 = red side, both high = orange.
 *  Needs silkscreen/bench confirmation against board hardware.
 */

interface GpioWrite { pin: number; high: boolean; }

interface GpioBackend {
    /** Set a single GPIO line. */
    setLine(pin: number, high: boolean): void;
    /** Set multiple GPIO lines. Applied in order — not a true atomic write at
     *  this transport level; a libgpiod backend can make it truly atomic. */
    setLines(writes: GpioWrite[]): void;
}

class PinctrlBackend implements GpioBackend {
    // Cache of the last-written level per pin so we can skip redundant writes.
    private readonly pinLevel = new Map<number, boolean>();
    // Rate-limited error logging: log once on first failure, then suppress.
    private ledErrorLogged = false;
    private buzzerErrorLogged = false;

    setLine(pin: number, high: boolean): void {
        if( this.pinLevel.get(pin) === high ) return;   // skip redundant write
        try{
            execSync(`pinctrl set ${pin} ${high ? 'dh' : 'dl'} >/dev/null 2>&1`);
            this.pinLevel.set(pin, high);
        } catch(err){
            this.reportError(pin, err);
        }
    }

    setLines(writes: GpioWrite[]): void {
        for( const w of writes ) this.setLine(w.pin, w.high);
    }

    private reportError(pin: number, err: unknown): void {
        const isBuzzer = (pin === 5);
        if( isBuzzer ){
            if( !this.buzzerErrorLogged ){
                console.error(`\x1b[31mEdgeberry buzzer GPIO error (pin ${pin}): ${err}\x1b[37m`);
                this.buzzerErrorLogged = true;
            }
        } else {
            if( !this.ledErrorLogged ){
                console.error(`\x1b[31mEdgeberry LED GPIO error (pin ${pin}): ${err}\x1b[37m`);
                this.ledErrorLogged = true;
            }
        }
    }
}

const gpio: GpioBackend = new PinctrlBackend();

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
        console.error('\x1b[31mEdgeberry Hardware indicators not inititialized!\x1b[37m');
    }
}

// Initialize
initialize();

// Set the color of the LED
// ASSUMPTION: gpio26 = green side, gpio19 = red side (inferred from driver truth
// table). Both high = orange. Needs silkscreen/bench confirmation.
function setLedColor( color:string ){
    switch( color ){
        // Red: gpio26 low, gpio19 high
        case 'red':     gpio.setLines([{pin:26,high:false},{pin:19,high:true}]);
                        break;
        // Green: gpio26 high, gpio19 low
        case 'green':   gpio.setLines([{pin:26,high:true},{pin:19,high:false}]);
                        break;
        // Orange: both high
        case 'orange':  gpio.setLines([{pin:26,high:true},{pin:19,high:true}]);
                        break;
        // Off (for anything else): both low
        default:        gpio.setLines([{pin:26,high:false},{pin:19,high:false}]);
                        break;
    }
}

// Set the buzzer on/off
function setBuzzerState( state:string ){
    gpio.setLine(5, state === 'on');
}

// Button

class ButtonEventEmitter extends EventEmitter {
    private lastValue:string = 'hi';        // stores the last known button value - default is 'hi' (button is active low)
    private pressStart:number = 0;          // stores the time when a button was pressed
    private pollingInterval:number = 500;   // polling interval in miliseconds (ms)

    constructor(){
        super();
        this.initialize();
    }

    private initialize(){
        try{
            // We've tried libraries like 'onoff', but that doesn't work for every
            // model because it uses the BCM pin numbers, which differ for each Pi.
            // So for now we'll just poll the pin. #ThisIsWhyImHot
            execSync('pinctrl set 6 ip');
            setInterval(async()=>{
                try{
                    // With pinctrl we get the value with some overhead, with sed we get out the 'hi' or 'lo'
                    const state = execSync("pinctrl get 6 | sed -n 's/.*| \\([^ ]*\\).*/\\1/p'").toString().split('\n')[0];
                    this.buttonEventHandler(state);
                }
                catch(err){
                    
                }
            }, this.pollingInterval);
        }
        catch(err){
            console.error('\x1b[31mEdgeberry Hardware button not inititialized!\x1b[37m');
        }
    }

    private buttonEventHandler(value:string){
        // Check for rising or falling edge
        if( value !== this.lastValue ){
            this.lastValue = value;
            switch(value){
                // rising edge (button release)
                case 'hi':  this.buttonPressTime(Date.now())
                            break;
                // falling edge (button press)
                case 'lo':  this.pressStart = Date.now();
                            break;
                default:    console.log('something odd happened with the button value');
                            break;
            }
        }
    }
    // Button press time
    // Calculate the time the button has been pressed,
    // relatively (short/long/...) and call the appropriate
    // function
    private buttonPressTime( pressEnd:number ){
        // 10 second press or longer
        if( (this.pressStart + 10000) < pressEnd){
            // TODO: Reset device to defaults
            this.emit('verylongpress');
        }
        // 5 second press
        else if((this.pressStart + 5000) <= pressEnd){
            this.emit('longpress');
        }
        // ~3 second press (AP mode toggle)
        else if((this.pressStart + 2500) <= pressEnd){
            this.emit('apToggle');
        }
        // long press
        else if((this.pressStart + 1700) <= pressEnd ){
            // TODO: User API 'long press' event
            this.emit('pressrelease');
        }
        // short press
        else{
            // TODO: User API 'short press' event
            this.emit('click');
        }
    }
}

// Initialize button
export const system_button = new ButtonEventEmitter();

system_button.on('click', ()=>{
    system_beepBuzzer('short');
});

system_button.on('longpress', ()=>{
    system_restart();
});