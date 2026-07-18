/** Jobs en memoria para sync masivo Hub → ML / TN (evita timeout del proxy ~60s). */

export type StockSyncPlatform = 'ml' | 'tn';

export type StockSyncJobStatus = 'idle' | 'running' | 'done' | 'error';

export type StockSyncFailure = {
  platform: 'Mercado Libre' | 'Tienda Nube';
  sku: string;
  productName: string;
  productSku: string;
  color: string;
  size: string;
  stockHub: number;
  stockSent: number;
  pack: number;
  externalId: string;
  reason: string;
};

export type StockSyncJob = {
  platform: StockSyncPlatform;
  status: StockSyncJobStatus;
  startedAt: number | null;
  finishedAt: number | null;
  updated: number;
  errors: number;
  total: number;
  logs: string[];
  failures: StockSyncFailure[];
  message: string;
};

const MAX_LOGS = 400;
const MAX_FAILURES = 5000;

const jobs: Record<StockSyncPlatform, StockSyncJob> = {
  ml: idleJob('ml'),
  tn: idleJob('tn'),
};

function idleJob(platform: StockSyncPlatform): StockSyncJob {
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

export function getStockSyncJob(platform: StockSyncPlatform): StockSyncJob {
  return {
    ...jobs[platform],
    logs: [...jobs[platform].logs],
    failures: [...jobs[platform].failures],
  };
}

export function isStockSyncRunning(platform: StockSyncPlatform): boolean {
  return jobs[platform].status === 'running';
}

/** Inicia job. Devuelve false si ya hay uno corriendo. */
export function beginStockSyncJob(platform: StockSyncPlatform, message: string): boolean {
  if (jobs[platform].status === 'running') return false;
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

export function finishStockSyncJob(
  platform: StockSyncPlatform,
  result: {
    updated: number;
    errors: number;
    total: number;
    logs: string[];
    failures?: StockSyncFailure[];
    message: string;
  }
): void {
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

export function failStockSyncJob(platform: StockSyncPlatform, message: string): void {
  jobs[platform] = {
    ...jobs[platform],
    status: 'error',
    finishedAt: Date.now(),
    message,
    logs: [...jobs[platform].logs, `[ERROR] ${message}`].slice(-MAX_LOGS),
  };
}

/** Fallos del último sync (uno o ambos). */
export function getStockSyncFailures(platform: 'ml' | 'tn' | 'both'): StockSyncFailure[] {
  if (platform === 'ml') return [...jobs.ml.failures];
  if (platform === 'tn') return [...jobs.tn.failures];
  return [...jobs.ml.failures, ...jobs.tn.failures];
}
