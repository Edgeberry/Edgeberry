/*
 *  Captive Portal
 *  AP-mode WiFi provisioning feature for the Edgeberry Web Server.
 *
 *  When the device has no saved WiFi connection it starts a hotspot and
 *  this module activates on the running WebServer:
 *   - Serves the provisioning wizard at the root path (/).
 *   - Exposes /provision/networks and /provision/connect API routes.
 *   - Installs a catch-all redirect so OS captive-portal detection
 *     (Apple, Android, Windows) triggers the popup automatically.
 *
 *  Everything is deactivated again once the device connects to WiFi.
 *
 *  DNS requirement:
 *  All DNS queries from AP clients must resolve to 10.42.0.1. Add:
 *
 *    /etc/NetworkManager/dnsmasq-shared.d/captive-portal.conf
 *      address=/#/10.42.0.1
 *
 *  NetworkManager picks this up on the next shared connection activation.
 */

import { Request, Response, NextFunction, Router } from 'express';
import { NetworkManager } from './network.manager';
import { WebServer } from './webServer';

const AP_ADDRESS = '10.42.0.1';

export class CaptivePortal {
    private networkManager: NetworkManager;
    private webServer: WebServer;
    private onConnected: (()=> void) | null = null;
    private active: boolean = false;

    constructor( webServer:WebServer, networkManager:NetworkManager ){
        this.webServer = webServer;
        this.networkManager = networkManager;
        this.mountRoutes();
    }

    /** Activate captive portal behaviour (call when entering AP mode). */
    public activate( onConnected:()=> void ):void{
        this.onConnected = onConnected;
        this.active = true;
        console.log('\x1b[33mCaptive Portal: active\x1b[37m');
    }

    /** Deactivate captive portal behaviour (call when leaving AP mode). */
    public deactivate():void{
        this.active = false;
        this.onConnected = null;
        console.log('\x1b[33mCaptive Portal: inactive\x1b[37m');
    }

    private mountRoutes():void{
        const app = this.webServer.getApp();

        // Network provisioning API — always available so the webUI can
        // offer a 'connect to network' feature regardless of AP mode.
        const router = Router();

        router.get('/networks', async (_req:Request, res:Response)=>{
            try{
                try{ await this.networkManager.requestScan(); } catch(_e){}
                await new Promise(r => setTimeout(r, 2000));
                const networks = await this.networkManager.getAccessPoints();
                res.json(networks);
            } catch(err){
                res.status(500).json({ error: 'Failed to retrieve networks' });
            }
        });

        router.post('/connect', async (req:Request, res:Response)=>{
            const { ssid, passphrase } = req.body;
            if(!ssid){
                res.status(400).json({ success:false, error:'Missing ssid' });
                return;
            }
            try{
                const success = await this.networkManager.connectToNetwork(ssid, passphrase || '');
                res.json({ success });
                if(success){
                    setTimeout(()=>{
                        this.deactivate();
                        if(this.onConnected) this.onConnected();
                    }, 3000);
                }
            } catch(err){
                res.json({ success:false });
            }
        });

        this.webServer.use('/provision', router);

        // Catch-all: redirect to portal for captive portal detection.
        // The 302 (not 200) triggers the OS captive portal popup on
        // Apple (hotspot-detect.html), Android (generate_204), and
        // Windows (connecttest.txt, ncsi.txt).
        app.use((_req:Request, res:Response, next:NextFunction)=>{
            if(this.active){
                res.redirect(302, 'http://'+AP_ADDRESS+'/');
            } else {
                next();
            }
        });
    }
}

// NOTE: provisioningPage() was removed here. The webUI will handle
// the 'connect to network' feature going forward. The /provision API
// routes above remain available for it to call at any time.
/*
function provisioningPage():string{
    return '<!DOCTYPE html>\
<html lang="en">\
<head>\
<meta charset="UTF-8">\
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">\
<title>Edgeberry WiFi Setup</title>\
<style>\
*{margin:0;padding:0;box-sizing:border-box}\
body{\
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;\
  background:#f5f5f5;color:#222;min-height:100vh;\
  display:flex;align-items:center;justify-content:center;padding:16px;\
}\
.portal{background:#fff;border-radius:12px;box-shadow:0 2px 16px rgba(0,0,0,.08);\
  width:100%;max-width:400px;padding:24px;}\
.portal-header{text-align:center;margin-bottom:24px;}\
.portal-header h1{font-size:20px;font-weight:700;}\
.portal-header p{color:#888;font-size:13px;margin-top:4px;}\
.step{display:none;}\
.step.active{display:block;}\
.step h2{font-size:15px;font-weight:600;margin-bottom:12px;}\
\
.network-list{margin-bottom:12px;max-height:320px;overflow-y:auto;}\
.network-item{\
  display:flex;justify-content:space-between;align-items:center;\
  width:100%;padding:12px;border:1px solid #eee;border-radius:8px;\
  margin-bottom:6px;background:#fff;cursor:pointer;text-align:left;\
  font-size:14px;font-family:inherit;\
}\
.network-item:active{background:#f0f0f0;}\
.network-ssid{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;}\
.network-info{display:flex;align-items:center;gap:8px;flex-shrink:0;margin-left:8px;}\
.network-lock{font-size:13px;}\
.network-loading,.network-empty,.network-error{\
  text-align:center;padding:32px 16px;color:#888;font-size:14px;\
}\
.network-error{color:#c00;}\
\
.strength-bars{display:inline-flex;align-items:flex-end;gap:2px;height:14px;}\
.bar{width:4px;background:#ddd;border-radius:1px;}\
.bar-1{height:5px;}.bar-2{height:9px;}.bar-3{height:14px;}\
.bar-filled{background:#444;}\
\
.step-subtitle{font-size:14px;color:#555;margin-bottom:16px;}\
.input-group{display:flex;gap:8px;margin-bottom:16px;}\
.input-group input{\
  flex:1;padding:10px 12px;border:1px solid #ccc;border-radius:8px;\
  font-size:14px;font-family:inherit;outline:none;\
}\
.input-group input:focus{border-color:#222;}\
.btn-toggle{\
  padding:10px 12px;border:1px solid #ccc;border-radius:8px;\
  background:#fff;cursor:pointer;font-size:13px;font-family:inherit;\
  white-space:nowrap;\
}\
.btn-group{display:flex;gap:8px;}\
.btn{\
  padding:10px 20px;border:none;border-radius:8px;\
  font-size:14px;font-family:inherit;cursor:pointer;\
}\
.btn-primary{background:#222;color:#fff;flex:1;}\
.btn-primary:active{background:#444;}\
.btn-secondary{background:#eee;color:#222;}\
.btn-secondary:active{background:#ddd;}\
\
.spinner{\
  width:28px;height:28px;border:3px solid #eee;border-top-color:#222;\
  border-radius:50%;animation:spin .7s linear infinite;margin:0 auto 16px;\
}\
@keyframes spin{to{transform:rotate(360deg)}}\
\
#step-result{text-align:center;padding:16px 0;}\
.result-title{font-size:17px;font-weight:600;margin-bottom:8px;}\
.result-note{color:#888;font-size:13px;margin-top:8px;}\
</style>\
</head>\
<body>\
<div class="portal">\
  <div class="portal-header">\
    <h1>Edgeberry</h1>\
    <p>WiFi Setup</p>\
  </div>\
\
  <div id="step-select" class="step active">\
    <h2>Select a network</h2>\
    <div id="network-list" class="network-list">\
      <div class="network-loading">Scanning for networks\u2026</div>\
    </div>\
    <button id="btn-refresh" class="btn btn-secondary" style="width:100%">Refresh</button>\
  </div>\
\
  <div id="step-password" class="step">\
    <h2>Enter password</h2>\
    <p class="step-subtitle">Network: <strong id="selected-ssid"></strong></p>\
    <div class="input-group">\
      <input type="password" id="input-passphrase" placeholder="WiFi password" autocomplete="off">\
      <button type="button" id="btn-show-password" class="btn-toggle">Show</button>\
    </div>\
    <div class="btn-group">\
      <button id="btn-back" class="btn btn-secondary">Back</button>\
      <button id="btn-connect" class="btn btn-primary">Connect</button>\
    </div>\
  </div>\
\
  <div id="step-result" class="step">\
    <div id="state-connecting">\
      <div class="spinner"></div>\
      <p>Connecting to <strong id="connecting-ssid"></strong>\u2026</p>\
    </div>\
    <div id="state-success" style="display:none">\
      <p class="result-title">Connected!</p>\
      <p>Successfully connected to <strong id="success-ssid"></strong>.</p>\
      <p class="result-note">This page will close shortly.</p>\
    </div>\
    <div id="state-failure" style="display:none">\
      <p class="result-title">Connection failed</p>\
      <p style="margin-bottom:16px">Could not connect. Check the password and try again.</p>\
      <button id="btn-retry" class="btn btn-primary">Try again</button>\
    </div>\
  </div>\
</div>\
\
<script>\
(function(){\
  var selectedSsid="";\
  var stepSelect=document.getElementById("step-select");\
  var stepPassword=document.getElementById("step-password");\
  var stepResult=document.getElementById("step-result");\
  var networkList=document.getElementById("network-list");\
  var selectedSsidEl=document.getElementById("selected-ssid");\
  var inputPassphrase=document.getElementById("input-passphrase");\
  var connectingSsidEl=document.getElementById("connecting-ssid");\
  var successSsidEl=document.getElementById("success-ssid");\
  var stateConnecting=document.getElementById("state-connecting");\
  var stateSuccess=document.getElementById("state-success");\
  var stateFailure=document.getElementById("state-failure");\
\
  function showStep(el){\
    stepSelect.className="step";\
    stepPassword.className="step";\
    stepResult.className="step";\
    el.className="step active";\
  }\
\
  function escapeHtml(s){\
    var d=document.createElement("div");\
    d.textContent=s;\
    return d.innerHTML;\
  }\
\
  function strengthBars(strength){\
    var level=strength>70?3:strength>40?2:1;\
    var h="";\
    for(var i=1;i<=3;i++){\
      h+="<span class=\\"bar bar-"+i+(i<=level?" bar-filled":"")+"\\"></span>";\
    }\
    return "<span class=\\"strength-bars\\">"+h+"</span>";\
  }\
\
  function loadNetworks(){\
    networkList.innerHTML="<div class=\\"network-loading\\">Scanning for networks\\u2026</div>";\
    fetch("/provision/networks")\
      .then(function(r){return r.json();})\
      .then(function(networks){\
        if(!networks.length){\
          networkList.innerHTML="<div class=\\"network-empty\\">No networks found</div>";\
          return;\
        }\
        networkList.innerHTML="";\
        networks.forEach(function(net){\
          var item=document.createElement("button");\
          item.className="network-item";\
          item.innerHTML=\
            "<span class=\\"network-ssid\\">"+escapeHtml(net.ssid)+"</span>"+\
            "<span class=\\"network-info\\">"+\
              (net.secured?"<span class=\\"network-lock\\">&#x1f512;</span>":"")+\
              strengthBars(net.strength)+\
            "</span>";\
          item.addEventListener("click",function(){selectNetwork(net);});\
          networkList.appendChild(item);\
        });\
      })\
      .catch(function(){\
        networkList.innerHTML="<div class=\\"network-error\\">Scan failed. Try refreshing.</div>";\
      });\
  }\
\
  function selectNetwork(net){\
    selectedSsid=net.ssid;\
    if(net.secured){\
      selectedSsidEl.textContent=net.ssid;\
      inputPassphrase.value="";\
      showStep(stepPassword);\
      inputPassphrase.focus();\
    }else{\
      doConnect(net.ssid,"");\
    }\
  }\
\
  function doConnect(ssid,passphrase){\
    connectingSsidEl.textContent=ssid;\
    stateConnecting.style.display="";\
    stateSuccess.style.display="none";\
    stateFailure.style.display="none";\
    showStep(stepResult);\
    fetch("/provision/connect",{\
      method:"POST",\
      headers:{"Content-Type":"application/json"},\
      body:JSON.stringify({ssid:ssid,passphrase:passphrase})\
    })\
    .then(function(r){return r.json();})\
    .then(function(data){\
      stateConnecting.style.display="none";\
      if(data.success){\
        successSsidEl.textContent=ssid;\
        stateSuccess.style.display="";\
      }else{\
        stateFailure.style.display="";\
      }\
    })\
    .catch(function(){\
      stateConnecting.style.display="none";\
      stateFailure.style.display="";\
    });\
  }\
\
  document.getElementById("btn-refresh").addEventListener("click",loadNetworks);\
  document.getElementById("btn-back").addEventListener("click",function(){showStep(stepSelect);});\
  document.getElementById("btn-connect").addEventListener("click",function(){\
    doConnect(selectedSsid,inputPassphrase.value);\
  });\
  document.getElementById("btn-show-password").addEventListener("click",function(){\
    if(inputPassphrase.type==="password"){\
      inputPassphrase.type="text";\
      this.textContent="Hide";\
    }else{\
      inputPassphrase.type="password";\
      this.textContent="Show";\
    }\
  });\
  document.getElementById("btn-retry").addEventListener("click",function(){\
    showStep(stepSelect);\
    loadNetworks();\
  });\
  inputPassphrase.addEventListener("keydown",function(e){\
    if(e.key==="Enter")doConnect(selectedSsid,inputPassphrase.value);\
  });\
\
  loadNetworks();\
})();\
</script>\
</body>\
</html>';
}
*/
