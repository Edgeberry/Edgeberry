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

// Starting, stopping and restarting the application are not implemented. The
// direct methods that would call them answer 501; see directMethods.ts.
