"use strict";
/** Jobs en memoria para sync masivo Hub → ML / TN (evita timeout del proxy ~60s). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStockSyncJob = getStockSyncJob;
exports.isStockSyncRunning = isStockSyncRunning;
exports.beginStockSyncJob = beginStockSyncJob;
exports.finishStockSyncJob = finishStockSyncJob;
exports.failStockSyncJob = failStockSyncJob;
exports.getStockSyncFailures = getStockSyncFailures;
const MAX_LOGS = 400;
const MAX_FAILURES = 5000;
const jobs = {
    ml: idleJob('ml'),
    tn: idleJob('tn'),
};
function idleJob(platform) {
    return {
        platform,
        status: 'idle',
        startedAt: null,
        finishedAt: null,
        updated: 0,
        errors: 0,
        total: 0,
        logs: [],
        failures: [],
        message: 'Sin sync en curso',
    };
}
function getStockSyncJob(platform) {
    return Object.assign(Object.assign({}, jobs[platform]), { logs: [...jobs[platform].logs], failures: [...jobs[platform].failures] });
}
function isStockSyncRunning(platform) {
    return jobs[platform].status === 'running';
}
/** Inicia job. Devuelve false si ya hay uno corriendo. */
function beginStockSyncJob(platform, message) {
    if (jobs[platform].status === 'running')
        return false;
    jobs[platform] = {
        platform,
        status: 'running',
        startedAt: Date.now(),
        finishedAt: null,
        updated: 0,
        errors: 0,
        total: 0,
        logs: [],
        failures: [],
        message,
    };
    return true;
}
function finishStockSyncJob(platform, result) {
    const logs = result.logs.length > MAX_LOGS
        ? [...result.logs.slice(0, 50), `… (${result.logs.length - MAX_LOGS} logs omitidos) …`, ...result.logs.slice(-MAX_LOGS + 51)]
        : result.logs;
    const failures = (result.failures || []).slice(0, MAX_FAILURES);
    jobs[platform] = {
        platform,
        status: 'done',
        startedAt: jobs[platform].startedAt,
        finishedAt: Date.now(),
        updated: result.updated,
        errors: result.errors,
        total: result.total,
        logs,
        failures,
        message: result.message,
    };
}
function failStockSyncJob(platform, message) {
    jobs[platform] = Object.assign(Object.assign({}, jobs[platform]), { status: 'error', finishedAt: Date.now(), message, logs: [...jobs[platform].logs, `[ERROR] ${message}`].slice(-MAX_LOGS) });
}
/** Fallos del último sync (uno o ambos). */
function getStockSyncFailures(platform) {
    if (platform === 'ml')
        return [...jobs.ml.failures];
    if (platform === 'tn')
        return [...jobs.tn.failures];
    return [...jobs.ml.failures, ...jobs.tn.failures];
}
