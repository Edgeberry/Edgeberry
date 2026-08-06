/*
 *  Settings store
 *  Persistent device configuration, kept in settings.json next to the
 *  certificates it references.
 *
 *  Paths are relative to the process working directory, which systemd sets to
 *  the application directory (see config/io.edgeberry.core.service). Running the
 *  application from anywhere else will not find the settings.
 */

import { readFileSync, writeFileSync } from "fs";

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

function saveSettings(){
    writeFileSync(settingsFilePath, JSON.stringify(settings, null, 2) );
}
