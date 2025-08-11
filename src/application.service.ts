/*
 *  Application
 *  Interaction with application related features
 */

export type ApplicationInfo = {
    name:'',
    description?:'',
    version?:''
}

// Application info
let app_applicationInfo:ApplicationInfo|null = null;

// Get system application info
export function app_getApplicationInfo(){
    return app_applicationInfo;
}

// Set the application info
export function app_setApplicationInfo( applicationInfo:ApplicationInfo ){
    app_applicationInfo = applicationInfo;
    console.log(app_applicationInfo);
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
