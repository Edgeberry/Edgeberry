/*
 *  Settings file
 */

import { readFileSync, writeFileSync } from "fs";

const settingsFilePath = 'settings.json';
const certificatesFolder = 'certificates'
// Provisioning certificates
const provisioningCertificateFile = certificatesFolder+'/provisioning_cert.pem';
const provisioningPrivateKeyFile = certificatesFolder+'/provisioning_key.pem';
const provisioningRootCAFile = certificatesFolder+'/provisioning_rootCA.pem';
// Connection certificates
const connectionCertificateFile = certificatesFolder+'/certificate.pem';
const connectionPrivateKeyFile = certificatesFolder+'/privateKey.pem';
const connectionRootCAFile = certificatesFolder+'/rootCertificate.pem';

export var settings:any = {};

// attempt to read the settings from the file
try{
    console.log('\x1b[90mReading settings from settings file...\x1b[37m');
    settings = JSON.parse(readFileSync(settingsFilePath).toString());
    console.log('\x1b[32mSettings read from settings file \x1b[37m');
} catch(err){
    console.error('\x1b[31mCould not read settings file! \x1b[37m');
    // ToDo: create settings file?
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

// Store provisioning parameters
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