/*
 *  Edgeberry CLI
 *  InterProcess Communication using stdin for interacting with Edgeberry
 * 
 *  Example: $ pm2 send 0 hello
 */

import { stateManager } from ".";

/* pm2 ipc poc */
process.stdin.on('data',( packet )=>{
    // the data we receive is a buffer, convert to string & remove line breaks
    const data = packet.toString().replace(/(\r\n|\n|\r)/gm,"");
    console.log( data );

    if( data === "identify" ) stateManager.interruptIndicators('identify');
});