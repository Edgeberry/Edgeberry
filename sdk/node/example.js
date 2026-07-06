"use strict";
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
const src_1 = require("./src");
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        const edge = new src_1.Edgeberry();
        yield edge.setApplicationInfo({
            name: 'example',
            version: '3.5.3',
            description: 'Edgeberry Node SDK example',
        });
        yield edge.setApplicationStatus({ level: 'ok', message: 'Running fine' });
        const unsubscribe = yield edge.onCloudMessage((payload) => {
            console.log('Cloud message received:', payload);
        });
        const interval = setInterval(() => __awaiter(this, void 0, void 0, function* () {
            try {
                const result = yield edge.sendMessage({
                    temperature: 22.5 + Math.random(),
                    humidity: 45 + Math.random() * 5,
                });
                if (result !== 'ok')
                    console.warn('sendMessage returned:', result);
            }
            catch (err) {
                console.error('sendMessage failed:', err);
            }
        }), 5000);
        process.on('SIGINT', () => {
            clearInterval(interval);
            unsubscribe();
            edge.close();
            process.exit(0);
        });
    });
}
main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
});
