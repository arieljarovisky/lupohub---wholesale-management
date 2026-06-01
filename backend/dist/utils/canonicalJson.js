"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canonicalizeJsonValue = canonicalizeJsonValue;
exports.canonicalStringify = canonicalStringify;
function isPlainObject(value) {
    return Object.prototype.toString.call(value) === '[object Object]';
}
function normalizeValue(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value))
            return null;
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((item) => normalizeValue(item));
    }
    if (isPlainObject(value)) {
        const out = {};
        const keys = Object.keys(value).sort();
        for (const key of keys) {
            out[key] = normalizeValue(value[key]);
        }
        return out;
    }
    return null;
}
function canonicalizeJsonValue(value) {
    return normalizeValue(value);
}
function canonicalStringify(value) {
    return JSON.stringify(canonicalizeJsonValue(value));
}
