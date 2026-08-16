/*
 *  Settings store
 *  Persistent device configuration, kept in settings.json next to the
 *  certificates it references.
 *
 *  Paths are relative to the process working directory, which systemd sets to
 *  the application directory (see config/io.edgeberry.core.service). Running the
 *  application from anywhere else will not find the settings.
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync } from "fs";

const settingsFilePath = 'settings.json';
const certificatesFolder = 'certificates';
// Provisioning certificates
const provisioningCertificateFile = certificatesFolder+'/provisioning_cert.pem';
const provisioningPrivateKeyFile = certificatesFolder+'/provisioning_key.pem';
const provisioningRootCAFile = certificatesFolder+'/provisioning_rootCA.pem';
// Connection certificates
const connectionCertificateFile = certificatesFolder+'/certificate.pem';
const connectionPrivateKeyFile = certificatesFolder+'/privateKey.pem';
const connectionRootCAFile = certificatesFolder+'/rootCertificate.pem';

export var settings:any = {};

/**
 * Read settings.json into memory.
 *
 * Called by the composition root rather than on import: reading a file from the
 * working directory as a side effect of `import` makes this module impossible
 * to load anywhere else, and hides a failure that matters at a point where
 * nobody is looking for it.
 *
 * A missing or unreadable file is not fatal — an unprovisioned device has no
 * settings yet, and `edgeberry --setup` writes the first one.
 */
export function settings_load():void{
    try{
        console.log('\x1b[90mReading settings from settings file...\x1b[37m');
        settings = JSON.parse(readFileSync(settingsFilePath).toString());
        console.log('\x1b[32mSettings read from settings file \x1b[37m');
    } catch(err){
        console.error('\x1b[31mCould not read settings file! \x1b[37m');
        settings = {};
    }
}

// Store connection parameters
export function settings_storeConnectionParameters( params:any ){
    var parameters = JSON.parse(JSON.stringify(params));    // hard copy the parameters, otherwise this is by reference
    settings.connection = parameters;

    // Write the certificate file
    if( typeof(parameters.certificate) === 'string' ){
        writeFileSync(connectionCertificateFile, parameters.certificate);
        delete parameters.certificate;
        parameters.certificateFile = connectionCertificateFile;
    }
    else{
        writeFileSync(connectionCertificateFile, '');
    }
    // Write the private key file
    if( typeof(parameters.privateKey) === 'string' ){
        writeFileSync(connectionPrivateKeyFile, parameters.privateKey );
        delete parameters.privateKey
        parameters.privateKeyFile = connectionPrivateKeyFile;
    }
    else{
        writeFileSync(connectionPrivateKeyFile, '');
    }
    // Write the Root Certificate file
    if( typeof(parameters.rootCertificate) === 'string' ){
        writeFileSync(connectionRootCAFile, parameters.rootCertificate );
        delete parameters.rootCertificate
        parameters.rootCertificateFile = connectionRootCAFile;
    }
    else{
        writeFileSync(connectionRootCAFile, '');
    }

    // Save the settings to the JSON file
    saveSettings();
}

// Delete connection parameters
export function settings_deleteConnectionParameters(){
    delete settings.connection;
    saveSettings();
}

/*
 *  Store provisioning parameters.
 *
 *  CAUTION: certificate, privateKey and rootCertificate must be passed as PEM
 *  *contents*. Anything not supplied as a string has its file truncated to
 *  empty — so passing the stored `...File` paths back in erases the very
 *  certificates this is meant to save.
 */
export function settings_storeProvisioningParameters( params:any ){
    var parameters = JSON.parse(JSON.stringify(params));    // hard copy the parameters, otherwise this is by reference
    settings.provisioning = parameters;

    // Write the certificate file
    if( typeof(parameters.certificate) === 'string' ){
        writeFileSync(provisioningCertificateFile, parameters.certificate);
        delete parameters.certificate;
        parameters.certificateFile = provisioningCertificateFile;
    }
    else{
        writeFileSync(provisioningCertificateFile, '');
    }
    // Write the private key file
    if( typeof(parameters.privateKey) === 'string' ){
        writeFileSync(provisioningPrivateKeyFile, parameters.privateKey );
        delete parameters.privateKey
        parameters.privateKeyFile = provisioningPrivateKeyFile;
    }
    else{
        writeFileSync(provisioningPrivateKeyFile, '');
    }
    // Write the Root Certificate file
    if( typeof(parameters.rootCertificate) === 'string' ){
        writeFileSync(provisioningRootCAFile, parameters.rootCertificate );
        delete parameters.rootCertificate
        parameters.rootCertificateFile = provisioningRootCAFile;
    }
    else{
        writeFileSync(provisioningRootCAFile, '');
    }

    // Save the settings to the JSON file
    saveSettings();
}

/*
 *  Erase the provisioning certificate/key from disk once they're no longer
 *  needed - i.e. once a real device certificate has been issued and stored via
 *  settings_storeConnectionParameters(). The provisioning cert is shared across
 *  the whole fleet (see certificates.ts), so leaving a copy of it (and its
 *  private key) sitting on a device after it has served its one purpose is
 *  needless exposure if that specific board is later compromised - deleting it
 *  narrows what a stolen board's storage can be used for.
 */
export function settings_deleteProvisioningParameters(){
    delete settings.provisioning;
    for(const file of [provisioningCertificateFile, provisioningPrivateKeyFile, provisioningRootCAFile]){
        try{ if(existsSync(file)) unlinkSync(file); } catch(_err){}
    }
    saveSettings();
}

/*
 *  The registered application.
 *
 *  The manifest is not copied here — it stays in the application's own
 *  directory, so an application that updates carries its own description with it
 *  rather than leaving a stale copy behind. Only the path is kept, plus the
 *  routes the application last declared, so its paths keep being served across a
 *  restart instead of going dark until it re-declares them.
 *
 *  One device runs one application, so registering replaces whatever was
 *  registered before rather than accumulating.
 */
export function settings_storeApplication( applicationPath:string, routes:unknown[] = [] ){
    settings.application = { path: applicationPath, routes };
    saveSettings();
}

export function settings_deleteApplication(){
    delete settings.application;
    saveSettings();
}

/** The registered application, or null when none is registered. */
export function settings_getApplication():{ path:string, routes:any[] }|null{
    const stored = settings?.application;
    if(!stored || typeof stored.path !== 'string' || !stored.path) return null;
    return { path: stored.path, routes: Array.isArray(stored.routes) ? stored.routes : [] };
}

/*
 *  The device name, and who owns it.
 *
 *  'managed' is the hostname Edgeberry last set and 'uuid' the base board
 *  suffix it was built from — together they answer 'is the name on this device
 *  still the name we gave it?', which is the whole of the ownership rule in
 *  hostname.ts.
 *
 *  'released' replaces both the moment someone renames the device by hand, and
 *  is what makes stepping back permanent. Without a record on disk the next
 *  start would simply take the name back, which is the behaviour this exists to
 *  prevent.
 */
export type HostnameRecord = {
    managed?:  string,
    uuid?:     string,
    released?: string,
};

/** Record the device name decision. Null forgets it, so the name is claimed again. */
export function settings_storeHostname( record:HostnameRecord|null ){
    if(record) settings.hostname = record;
    else       delete settings.hostname;
    saveSettings();
}

export function settings_getHostname():HostnameRecord|null{
    const stored = settings?.hostname;
    return stored && typeof stored === 'object' ? stored as HostnameRecord : null;
}

function saveSettings(){
    writeFileSync(settingsFilePath, JSON.stringify(settings, null, 2) );
}
