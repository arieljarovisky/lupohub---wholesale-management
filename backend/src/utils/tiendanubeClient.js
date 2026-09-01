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
exports.tnPutWithRetry = tnPutWithRetry;
exports.tnPostWithRetry = tnPostWithRetry;
exports.tnGetWithRetry = tnGetWithRetry;
exports.tnDeleteWithRetry = tnDeleteWithRetry;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
/**
 * Rate limiter global (en memoria) para requests a Tienda Nube.
 * Evita que distintas rutas/flows (AutoSync, sync stock, webhooks, etc.) saturen la API y generen 429.
 */
let tnQueue = Promise.resolve();
let lastTnRequestAt = 0;
function getRetryAfterMs(err) {
    var _a, _b, _c, _d, _e;
    const raw = (_c = (_b = (_a = err === null || err === void 0 ? void 0 : err.response) === null || _a === void 0 ? void 0 : _a.headers) === null || _b === void 0 ? void 0 : _b['retry-after']) !== null && _c !== void 0 ? _c : (_e = (_d = err === null || err === void 0 ? void 0 : err.response) === null || _d === void 0 ? void 0 : _d.headers) === null || _e === void 0 ? void 0 : _e['Retry-After'];
    if (!raw)
        return null;
    const s = Array.isArray(raw) ? raw[0] : raw;
    const n = Number(s);
    if (Number.isFinite(n) && n > 0)
        return Math.floor(n * 1000);
    return null;
}
function scheduleTn(fn, minIntervalMs) {
    return __awaiter(this, void 0, void 0, function* () {
        let resolveDone;
        const done = new Promise(r => (resolveDone = r));
        const prev = tnQueue;
        tnQueue = tnQueue.then(() => done).catch(() => done);
        yield prev;
        const now = Date.now();
        const wait = Math.max(0, minIntervalMs - (now - lastTnRequestAt));
        if (wait > 0)
            yield sleep(wait);
        try {
            return yield fn();
        }
        finally {
            lastTnRequestAt = Date.now();
            resolveDone();
        }
    });
}
function tnPutWithRetry(axiosInstance, url, body, config, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const maxRetries = Math.max(0, (_a = opts === null || opts === void 0 ? void 0 : opts.maxRetries) !== null && _a !== void 0 ? _a : 4);
        const envInterval = parseInt(process.env.TN_RATE_LIMIT_DELAY_MS || '800', 10);
        const resolvedInterval = (_b = opts === null || opts === void 0 ? void 0 : opts.minIntervalMs) !== null && _b !== void 0 ? _b : (Number.isFinite(envInterval) ? envInterval : 800);
        const minIntervalMs = Math.max(0, resolvedInterval);
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                yield scheduleTn(() => axiosInstance.put(url, body, config), minIntervalMs);
                return;
            }
            catch (e) {
                const status = (_c = e === null || e === void 0 ? void 0 : e.response) === null || _c === void 0 ? void 0 : _c.status;
                const is429 = status === 429;
                const isNetwork = (e === null || e === void 0 ? void 0 : e.code) === 'ECONNRESET' || (e === null || e === void 0 ? void 0 : e.code) === 'ETIMEDOUT' || (e === null || e === void 0 ? void 0 : e.code) === 'ECONNREFUSED';
                if ((is429 || isNetwork) && attempt < maxRetries) {
                    const retryAfterMs = is429 ? getRetryAfterMs(e) : null;
                    const backoffMs = 1500 + attempt * 1500;
                    yield sleep(Math.max(retryAfterMs !== null && retryAfterMs !== void 0 ? retryAfterMs : 0, backoffMs));
                    continue;
                }
                throw e;
            }
        }
    });
}
function tnPostWithRetry(axiosInstance, url, body, config, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const maxRetries = Math.max(0, (_a = opts === null || opts === void 0 ? void 0 : opts.maxRetries) !== null && _a !== void 0 ? _a : 4);
        const envInterval = parseInt(process.env.TN_RATE_LIMIT_DELAY_MS || '800', 10);
        const resolvedInterval = (_b = opts === null || opts === void 0 ? void 0 : opts.minIntervalMs) !== null && _b !== void 0 ? _b : (Number.isFinite(envInterval) ? envInterval : 800);
        const minIntervalMs = Math.max(0, resolvedInterval);
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return yield scheduleTn(() => axiosInstance.post(url, body, config), minIntervalMs);
            }
            catch (e) {
                const status = (_c = e === null || e === void 0 ? void 0 : e.response) === null || _c === void 0 ? void 0 : _c.status;
                const is429 = status === 429;
                const isNetwork = (e === null || e === void 0 ? void 0 : e.code) === 'ECONNRESET' || (e === null || e === void 0 ? void 0 : e.code) === 'ETIMEDOUT' || (e === null || e === void 0 ? void 0 : e.code) === 'ECONNREFUSED';
                if ((is429 || isNetwork) && attempt < maxRetries) {
                    const retryAfterMs = is429 ? getRetryAfterMs(e) : null;
                    const backoffMs = 1500 + attempt * 1500;
                    yield sleep(Math.max(retryAfterMs !== null && retryAfterMs !== void 0 ? retryAfterMs : 0, backoffMs));
                    continue;
                }
                throw e;
            }
        }
        throw new Error('tnPostWithRetry: retries exhausted');
    });
}
function tnGetWithRetry(axiosInstance, url, config, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const maxRetries = Math.max(0, (_a = opts === null || opts === void 0 ? void 0 : opts.maxRetries) !== null && _a !== void 0 ? _a : 4);
        const envInterval = parseInt(process.env.TN_RATE_LIMIT_DELAY_MS || '800', 10);
        const resolvedInterval = (_b = opts === null || opts === void 0 ? void 0 : opts.minIntervalMs) !== null && _b !== void 0 ? _b : (Number.isFinite(envInterval) ? envInterval : 800);
        const minIntervalMs = Math.max(0, resolvedInterval);
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return yield scheduleTn(() => axiosInstance.get(url, config), minIntervalMs);
            }
            catch (e) {
                const status = (_c = e === null || e === void 0 ? void 0 : e.response) === null || _c === void 0 ? void 0 : _c.status;
                const is429 = status === 429;
                const isNetwork = (e === null || e === void 0 ? void 0 : e.code) === 'ECONNRESET' || (e === null || e === void 0 ? void 0 : e.code) === 'ETIMEDOUT' || (e === null || e === void 0 ? void 0 : e.code) === 'ECONNREFUSED';
                if ((is429 || isNetwork) && attempt < maxRetries) {
                    const retryAfterMs = is429 ? getRetryAfterMs(e) : null;
                    const backoffMs = 1500 + attempt * 1500;
                    yield sleep(Math.max(retryAfterMs !== null && retryAfterMs !== void 0 ? retryAfterMs : 0, backoffMs));
                    continue;
                }
                throw e;
            }
        }
        throw new Error('tnGetWithRetry: retries exhausted');
    });
}
function tnDeleteWithRetry(axiosInstance, url, config, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const maxRetries = Math.max(0, (_a = opts === null || opts === void 0 ? void 0 : opts.maxRetries) !== null && _a !== void 0 ? _a : 4);
        const envInterval = parseInt(process.env.TN_RATE_LIMIT_DELAY_MS || '800', 10);
        const resolvedInterval = (_b = opts === null || opts === void 0 ? void 0 : opts.minIntervalMs) !== null && _b !== void 0 ? _b : (Number.isFinite(envInterval) ? envInterval : 800);
        const minIntervalMs = Math.max(0, resolvedInterval);
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                yield scheduleTn(() => axiosInstance.delete(url, config), minIntervalMs);
                return;
            }
            catch (e) {
                const status = (_c = e === null || e === void 0 ? void 0 : e.response) === null || _c === void 0 ? void 0 : _c.status;
                const is429 = status === 429;
                const isNetwork = (e === null || e === void 0 ? void 0 : e.code) === 'ECONNRESET' || (e === null || e === void 0 ? void 0 : e.code) === 'ETIMEDOUT' || (e === null || e === void 0 ? void 0 : e.code) === 'ECONNREFUSED';
                if ((is429 || isNetwork) && attempt < maxRetries) {
                    const retryAfterMs = is429 ? getRetryAfterMs(e) : null;
                    const backoffMs = 1500 + attempt * 1500;
                    yield sleep(Math.max(retryAfterMs !== null && retryAfterMs !== void 0 ? retryAfterMs : 0, backoffMs));
                    continue;
                }
                throw e;
            }
        }
    });
}
