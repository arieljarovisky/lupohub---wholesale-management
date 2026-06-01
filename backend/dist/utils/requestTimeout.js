"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withRequestTimeout = void 0;
/** Ejecuta una promesa con tope de tiempo; evita que el proxy (Railway) corte con 502 sin CORS. */
function withRequestTimeout(ms, fn, timeoutMessage) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            const err = new Error(timeoutMessage);
            err.status = 504;
            err.code = 'REQUEST_TIMEOUT';
            reject(err);
        }, ms);
        fn()
            .then((value) => {
            clearTimeout(timer);
            resolve(value);
        })
            .catch((err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}
exports.withRequestTimeout = withRequestTimeout;
