/*
 *  Device Hub Setup
 *  Fetches provisioning certificates from a Device Hub and reports on the
 *  certificates already on disk.
 *
 *  This mirrors what `edgeberry --setup` (scripts/setup.sh) does, so the same
 *  onboarding is available from the web interface. The endpoint list and the
 *  order they are tried are kept deliberately identical to that script: if the
 *  hub changes, both must change together.
 *
 *  Note on TLS: HTTPS is attempted with certificate verification on, exactly
 *  as setup.sh's plain `curl` does. A hub serving a self-signed certificate
 *  therefore fails the HTTPS attempt and is picked up by the HTTP fallback —
 *  matching the script's behaviour rather than silently accepting any cert.
 */

import { request as httpsRequest } from 'https';
import { request as httpRequest } from 'http';
import { execFileSync } from 'child_process';
import { existsSync, statSync } from 'fs';

// Candidates in setup.sh's order: HTTPS for production, then the plain-HTTP
// ports a development hub is likely to be on.
const CANDIDATES: { protocol:'https'|'http'; port:number }[] = [
    { protocol:'https', port:443  },
    { protocol:'http',  port:8080 },
    { protocol:'http',  port:80   },
    { protocol:'http',  port:3000 },
];

// Endpoint filename for each certificate we need.
const ENDPOINTS = {
    certificate:     'provisioning.crt',
    privateKey:      'provisioning.key',
    rootCertificate: 'ca.crt',
};

export type ProvisioningCertificates = {
    certificate:     string;
    privateKey:      string;
    rootCertificate: string;
    via:             string;   // e.g. 'https:443' — which candidate answered
};

export type CertificateInfo = {
    present:        boolean;
    subject?:       string;
    issuer?:        string;
    notAfter?:      string;
    expired?:       boolean;
    daysRemaining?: number;
};

// GET a single URL, resolving with the body only on HTTP 200.
function fetchOnce( protocol:'https'|'http', hostName:string, port:number, path:string, timeoutMs:number ):Promise<string>{
    return new Promise((resolve, reject)=>{
        const doRequest = protocol === 'https' ? httpsRequest : httpRequest;
        const req = doRequest({ host: hostName, port, path, method: 'GET', timeout: timeoutMs }, (res)=>{
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk)=>{ body += chunk; });
            res.on('end', ()=>{
                if(res.statusCode === 200) resolve(body);
                else reject(new Error('HTTP '+res.statusCode));
            });
        });
        req.on('timeout', ()=>{ req.destroy(new Error('timeout')); });
        req.on('error', reject);
        req.end();
    });
}

/*
 *  Fetch all three provisioning certificates from a Device Hub.
 *  Tries each candidate protocol/port in turn and accepts the first one that
 *  serves all three — a hub answering some but not all is treated as a miss,
 *  since a partial set cannot provision.
 */
export async function fetchProvisioningCertificates( hostName:string, timeoutMs:number = 20000 ):Promise<ProvisioningCertificates>{
    const failures:string[] = [];

    for(const { protocol, port } of CANDIDATES){
        try{
            const [certificate, privateKey, rootCertificate] = await Promise.all([
                fetchOnce(protocol, hostName, port, '/api/provisioning/certs/'+ENDPOINTS.certificate,     timeoutMs),
                fetchOnce(protocol, hostName, port, '/api/provisioning/certs/'+ENDPOINTS.privateKey,      timeoutMs),
                fetchOnce(protocol, hostName, port, '/api/provisioning/certs/'+ENDPOINTS.rootCertificate, timeoutMs),
            ]);
            // Guard against a hub that answers 200 with an error page rather
            // than PEM — provisioning would otherwise fail much later, with a
            // far less obvious message.
            for(const [name, pem] of Object.entries({ certificate, privateKey, rootCertificate })){
                if(!pem.includes('-----BEGIN'))
                    throw new Error(name+' is not PEM');
            }
            return { certificate, privateKey, rootCertificate, via: protocol+':'+port };
        } catch(err:any){
            failures.push(protocol+':'+port+' ('+(err?.message ?? 'failed')+')');
        }
    }

    throw new Error('Could not fetch provisioning certificates from '+hostName+'. Tried '+failures.join(', '));
}

/*
 *  Describe a certificate on disk. Used to show the operator why a connection
 *  might be failing — an expired device certificate is otherwise invisible.
 */
export function readCertificateInfo( path:string ):CertificateInfo{
    try{
        if(!existsSync(path) || statSync(path).size === 0) return { present:false };
        const out = execFileSync('openssl', ['x509', '-in', path, '-noout', '-subject', '-issuer', '-enddate'], { encoding:'utf8' });

        const pick = (prefix:string)=>{
            const line = out.split('\n').find(l=> l.startsWith(prefix));
            return line ? line.slice(prefix.length).trim() : undefined;
        };

        const notAfterRaw = pick('notAfter=');
        const notAfter    = notAfterRaw ? new Date(notAfterRaw) : undefined;
        const valid       = notAfter && !isNaN(notAfter.getTime());

        return {
            present:       true,
            subject:       pick('subject='),
            issuer:        pick('issuer='),
            notAfter:      valid ? notAfter!.toISOString() : notAfterRaw,
            expired:       valid ? notAfter!.getTime() < Date.now() : undefined,
            daysRemaining: valid ? Math.floor((notAfter!.getTime() - Date.now()) / 86400000) : undefined,
        };
    } catch(_err){
        // openssl missing or the file is not a certificate — report presence
        // only rather than failing the whole status endpoint.
        return { present: existsSync(path) };
    }
}
