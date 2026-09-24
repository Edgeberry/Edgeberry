/*
 *  Network Reporter
 *  Mirrors the device's network settings into its twin: which medium carries
 *  traffic, the IPv4 configuration in force, and - on WiFi - the access point
 *  it is associated with and how well.
 *
 *  Why this is not part of the StateManager
 *  ----------------------------------------
 *  Three reasons, each of them on its own enough:
 *
 *   1. The StateManager normalises every value through canonical(), which
 *      lowercases and stringifies. An SSID would arrive as 'my-home-wifi' and a
 *      signal strength as '72'. Its state is a small set of known-value enums,
 *      and these are neither.
 *   2. Every write to the StateManager republishes the *whole* state document
 *      (see the TODO in main.ts). Signal strength changes continuously, so
 *      routing it through there would republish everything the device knows
 *      about itself every time the radio twitched.
 *   3. The hub merges reported twin documents shallowly, one top-level key at a
 *      time. Publishing 'network' as one complete object is therefore a single
 *      atomic update, which is exactly the unit this file produces.
 *
 *  Cadence
 *  -------
 *  Discrete facts - a new SSID, an address change, coming online - are
 *  event-driven: main.ts already subscribes to NetworkManager for both, and
 *  nudges this reporter from those callbacks.
 *
 *  Signal strength is the awkward one. It varies continuously and would
 *  otherwise drive every publish by itself, so it is sampled on a timer and
 *  only published once it has moved past a deadband. That keeps a wandering
 *  RSSI from writing to every device's row in the hub's twin database every
 *  minute, which across a fleet is a real cost on synchronous SQLite.
 *
 *  A twin holds latest-value, not history. If signal strength over time is ever
 *  wanted, that is telemetry, and it belongs in sendTelemetry() instead.
 */

import {
    NetworkManager,
    Connectivity,
    NetworkMedium,
    Ip4Details,
    ActiveAccessPointInfo,
} from './networkManager';
import { DeviceHubService } from './deviceHub';

/** The document published under the twin's 'network' key. */
export type NetworkReport = {
    medium:       NetworkMedium;
    interface:    string|null;
    mac:          string|null;
    connectivity: Connectivity;
    ipv4:         Ip4Details;
    wifi:         ActiveAccessPointInfo|null;
    updatedAt:    string;
};

/*
 *  How often to ask NetworkManager what the radio is doing. Only a sample - a
 *  sample is not a publish.
 */
const SAMPLE_MS = 60 * 1000;

/*
 *  How far signal strength has to move before it is worth telling the hub.
 *
 *  NetworkManager reports 0-100. Ten points is roughly the difference between
 *  bars on an indicator: below that nobody would act on the change, and every
 *  publish of it costs a write on the hub.
 */
const STRENGTH_DEADBAND = 10;

/*
 *  Republish an unchanged report this often anyway.
 *
 *  A twin document carries no freshness of its own, so a device sitting on a
 *  stable network would leave one behind with an `updatedAt` from whenever the
 *  network last changed - weeks ago, on a device that is working perfectly.
 *  This makes a stale-looking report distinguishable from a stalled reporter.
 */
const REFRESH_MS = 15 * 60 * 1000;

export class NetworkReporter {
    private timer:           NodeJS.Timeout|null = null;
    private last:            NetworkReport|null  = null;
    private lastPublishedAt: number              = 0;
    private connectivity:    Connectivity        = 'unknown';
    private sampling                             = false;

    constructor(
        private readonly networkManager: NetworkManager,
        private readonly deviceHub:      DeviceHubService,
    ){}

    /*
     *  Lifecycle
     */

    public start():void{
        if(this.timer) return;
        this.timer = setInterval(()=>{ void this.sample(false); }, SAMPLE_MS);
        // Nothing should be kept alive by this alone; the web server is what
        // holds the process open.
        this.timer.unref?.();
        void this.sample(false);
    }

    public stop():void{
        if(!this.timer) return;
        clearInterval(this.timer);
        this.timer = null;
    }

    /*
     *  Triggers
     */

    /**
     * Publish the current report regardless of whether anything changed.
     *
     * Called when the hub connection comes up. publishState() drops what it
     * cannot send, so without this a device that booted onto a network it then
     * stays on would have no network document in its twin until something about
     * that network changed - which on a working device could be never.
     */
    public publishNow():void{
        void this.sample(true);
    }

    /** Something about the link changed; look now rather than at the next tick. */
    public nudge():void{
        void this.sample(false);
    }

    /**
     * Record NetworkManager's connectivity assessment.
     *
     * Taken from the subscription main.ts already holds rather than probed
     * again here: CheckConnectivity is an active probe, and two of them
     * disagreeing about the same moment would be worse than one slightly old
     * answer.
     */
    public onConnectivityChange( connectivity:Connectivity ):void{
        this.connectivity = connectivity;
        this.nudge();
    }

    /*
     *  Reporting
     */

    /**
     * Everything the device currently knows about its network.
     *
     * Public because it is also the answer to the getSystemNetworkInfo direct
     * method: what the hub pulls and what this pushes must be the same facts
     * gathered the same way, or the two will eventually disagree and somebody
     * will spend an afternoon on it.
     */
    public async report():Promise<NetworkReport>{
        const { path, medium } = await this.networkManager.getPrimaryDevice();

        if(!path){
            return {
                medium:       'none',
                interface:    null,
                mac:          null,
                connectivity: this.connectivity,
                ipv4:         { address: null, prefix: null, gateway: null, dns: [] },
                wifi:         null,
                updatedAt:    new Date().toISOString(),
            };
        }

        const [link, ipv4, wifi] = await Promise.all([
            this.networkManager.getLinkDetails(path),
            this.networkManager.getIp4Details(path),
            medium === 'wifi'
                ? this.networkManager.getActiveAccessPointInfo(path)
                : Promise.resolve(null),
        ]);

        return {
            medium,
            interface:    link.interface,
            mac:          link.mac,
            connectivity: this.connectivity,
            ipv4,
            wifi,
            updatedAt:    new Date().toISOString(),
        };
    }

    /*
     *  Publishing
     */

    private async sample( force:boolean ):Promise<void>{
        // A D-Bus sweep is several round trips. On a device whose NetworkManager
        // is slow to answer, ticks would otherwise stack up behind each other.
        if(this.sampling) return;

        /*
         *  Nothing to publish through.
         *
         *  Deliberately leaves `last` alone, so the first sample after the
         *  connection returns compares against what the hub was last actually
         *  told, rather than against a report it never saw.
         *
         *  Not subject to `force`: that means "publish even if unchanged", and
         *  no amount of forcing gets a message out over a connection that is
         *  down. publishState() would drop it silently and this would then
         *  record a publish that never happened — which is precisely the bug
         *  publishNow() exists to prevent.
         */
        if(!this.deviceHub.isConnected()) return;

        this.sampling = true;
        try{
            const next  = await this.report();
            const stale = Date.now() - this.lastPublishedAt >= REFRESH_MS;

            if(!force && !stale && this.last && !this.hasChanged(this.last, next)) return;

            this.deviceHub.publishState('network', next);
            this.last            = next;
            this.lastPublishedAt = Date.now();
        } catch(err){
            console.error('\x1b[31mNetwork report failed: '+err+'\x1b[37m');
        } finally{
            this.sampling = false;
        }
    }

    /**
     * Whether two reports differ in a way worth a publish.
     *
     * Everything is compared exactly except three fields: the timestamp, which
     * always differs and would make every report look changed; signal strength,
     * which gets the deadband; and bitrate, which renegotiates constantly and
     * is nobody's reason to write to the hub. The latter two still ride along
     * in whatever publish something else triggers - they are excluded from
     * causing one, not from being reported.
     */
    private hasChanged( previous:NetworkReport, next:NetworkReport ):boolean{
        const withoutVolatile = ( report:NetworkReport ) => JSON.stringify({
            ...report,
            updatedAt: null,
            wifi: report.wifi ? { ...report.wifi, strength: null, bitrate: null } : null,
        });

        if(withoutVolatile(previous) !== withoutVolatile(next)) return true;

        const before = previous.wifi?.strength ?? null;
        const after  = next.wifi?.strength ?? null;
        if(before === null || after === null) return before !== after;
        return Math.abs(after - before) >= STRENGTH_DEADBAND;
    }
}
