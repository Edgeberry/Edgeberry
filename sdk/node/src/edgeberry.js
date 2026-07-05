"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Edgeberry = exports.EDGEBERRY_INTERFACE = exports.EDGEBERRY_OBJECT_PATH = exports.EDGEBERRY_SERVICE = void 0;
const events_1 = require("events");
const dbus = __importStar(require("dbus-next"));
exports.EDGEBERRY_SERVICE = 'io.edgeberry.Core';
exports.EDGEBERRY_OBJECT_PATH = '/io/edgeberry/Core';
exports.EDGEBERRY_INTERFACE = 'io.edgeberry.Core';
class Edgeberry extends events_1.EventEmitter {
    constructor(options = {}) {
        var _a;
        super();
        this.bus = null;
        this.iface = null;
        this.ifacePromise = null;
        this.busKind = (_a = options.bus) !== null && _a !== void 0 ? _a : 'system';
    }
    identify() {
        return __awaiter(this, void 0, void 0, function* () {
            const iface = yield this.getInterface();
            yield iface.Identify();
        });
    }
    setApplicationInfo(info) {
        return __awaiter(this, void 0, void 0, function* () {
            const iface = yield this.getInterface();
            return iface.SetApplicationInfo(JSON.stringify(info));
        });
    }
    setApplicationStatus(statusOrLevel, message) {
        return __awaiter(this, void 0, void 0, function* () {
            const payload = typeof statusOrLevel === 'string'
                ? { level: statusOrLevel, message }
                : statusOrLevel;
            const iface = yield this.getInterface();
            return iface.SetApplicationStatus(JSON.stringify(payload));
        });
    }
    sendMessage(data) {
        return __awaiter(this, void 0, void 0, function* () {
            const iface = yield this.getInterface();
            return iface.SendMessage(JSON.stringify(data));
        });
    }
    onCloudMessage(handler) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.subscribeJson('CloudMessage', handler);
        });
    }
    onButtonEvent(handler) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.subscribeJson('ButtonEvent', handler);
        });
    }
    onState(handler) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.subscribeJson('StateUpdate', handler);
        });
    }
    getState() {
        return __awaiter(this, void 0, void 0, function* () {
            const iface = yield this.getInterface();
            const raw = yield iface.GetState();
            if (!raw)
                throw new Error('Edgeberry: GetState returned an empty response');
            return JSON.parse(raw);
        });
    }
    close() {
        if (this.bus) {
            try {
                this.bus.disconnect();
            }
            catch (_a) {
            }
        }
        this.bus = null;
        this.iface = null;
        this.ifacePromise = null;
    }
    subscribeJson(signalName, handler) {
        return __awaiter(this, void 0, void 0, function* () {
            const iface = yield this.getInterface();
            const listener = (json) => {
                let payload = json;
                try {
                    payload = JSON.parse(json);
                }
                catch (_a) {
                }
                handler(payload);
            };
            iface.on(signalName, listener);
            return () => {
                iface.off(signalName, listener);
            };
        });
    }
    getInterface() {
        if (this.iface)
            return Promise.resolve(this.iface);
        if (this.ifacePromise)
            return this.ifacePromise;
        this.ifacePromise = (() => __awaiter(this, void 0, void 0, function* () {
            this.bus = this.busKind === 'system' ? dbus.systemBus() : dbus.sessionBus();
            const proxy = yield this.bus.getProxyObject(exports.EDGEBERRY_SERVICE, exports.EDGEBERRY_OBJECT_PATH);
            const iface = proxy.getInterface(exports.EDGEBERRY_INTERFACE);
            this.iface = iface;
            return iface;
        }))();
        this.ifacePromise.catch(() => {
            this.ifacePromise = null;
        });
        return this.ifacePromise;
    }
}
exports.Edgeberry = Edgeberry;
