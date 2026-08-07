/*
 *  Application
 *  Interaction with application related features
 */

// Mirrors the published SDK contract (sdk/node/src/edgeberry.ts). These fields
// were declared as the literal type '' rather than string, which made every
// value except the empty string unassignable — the `as ApplicationInfo` cast in
// dbusInterface.ts was the only reason it type-checked.
export type ApplicationInfo = {
    name: string,
    description?: string,
    version?: string
}

// The status an application reports over D-Bus. 'level' is the severity, and
// the SDKs also document 'error' between 'warning' and 'critical'.
export type ApplicationStatus = {
    level: string,
    message?: string
}

// Application info
let app_applicationInfo:ApplicationInfo|null = null;

// Last status the application reported.
//
// The severity is also pushed into the StateManager because it drives the
// status LED and buzzer. The message is kept here instead: everything the
// StateManager stores goes through canonical(), which lowercases and trims —
// fine for state enums, wrong for text meant to be shown to a human.
let app_applicationStatus:ApplicationStatus|null = null;

// Get system application info
export function app_getApplicationInfo(){
    return app_applicationInfo;
}

// Set the application info
export function app_setApplicationInfo( applicationInfo:ApplicationInfo ){
    app_applicationInfo = applicationInfo;
    console.log(app_applicationInfo);
}

// Get the last reported application status
export function app_getApplicationStatus(){
    return app_applicationStatus;
}

// Set the application status
export function app_setApplicationStatus( applicationStatus:ApplicationStatus ){
    app_applicationStatus = applicationStatus;
}

// Starting, stopping and restarting the application are not implemented. The
// direct methods that would call them answer 501; see directMethods.ts.
