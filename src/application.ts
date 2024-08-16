/*
 *  Application
 *  Interaction with application related features
 */

// Get system application info
// Using PM2
export function app_getApplicationInfo():Promise<string|any>{
    return new Promise<string|any>((resolve, reject)=>{
        resolve('Not implemented');
    });
}

// Restart the application
export function app_restartApplication():Promise<string>{
    return new Promise<string>((resolve, reject)=>{
        resolve('Not implemented');
    });
}

// Stop the application
export function app_stopApplication():Promise<string>{
    return new Promise<string>((resolve, reject)=>{
        resolve('Not implemented');
    });
}
