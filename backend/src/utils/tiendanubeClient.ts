const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Rate limiter global (en memoria) para requests a Tienda Nube.
 * Evita que distintas rutas/flows (AutoSync, sync stock, webhooks, etc.) saturen la API y generen 429.
 */
let tnQueue: Promise<void> = Promise.resolve();
let lastTnRequestAt = 0;

function getRetryAfterMs(err: any): number | null {
  const raw = err?.response?.headers?.['retry-after'] ?? err?.response?.headers?.['Retry-After'];
  if (!raw) return null;
  const s = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(s);
  if (Number.isFinite(n) && n > 0) return Math.floor(n * 1000);
  return null;
}

async function scheduleTn<T>(fn: () => Promise<T>, minIntervalMs: number): Promise<T> {
  let resolveDone!: () => void;
  const done = new Promise<void>(r => (resolveDone = r));
  const prev = tnQueue;
  tnQueue = tnQueue.then(() => done).catch(() => done);

  await prev;
  const now = Date.now();
  const wait = Math.max(0, minIntervalMs - (now - lastTnRequestAt));
  if (wait > 0) await sleep(wait);

  try {
    return await fn();
  } finally {
    lastTnRequestAt = Date.now();
    resolveDone();
  }
}

export async function tnPutWithRetry(
  axiosInstance: { put: (url: string, body: any, config: any) => Promise<any> },
  url: string,
  body: any,
  config: any,
  opts?: { maxRetries?: number; minIntervalMs?: number }
): Promise<void> {
  const maxRetries = Math.max(0, opts?.maxRetries ?? 4);
  const envInterval = parseInt(process.env.TN_RATE_LIMIT_DELAY_MS || '800', 10);
  const resolvedInterval = opts?.minIntervalMs ?? (Number.isFinite(envInterval) ? envInterval : 800);
  const minIntervalMs = Math.max(0, resolvedInterval);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await scheduleTn(() => axiosInstance.put(url, body, config), minIntervalMs);
      return;
    } catch (e: any) {
      const status = e?.response?.status;
      const is429 = status === 429;
      const isNetwork = e?.code === 'ECONNRESET' || e?.code === 'ETIMEDOUT' || e?.code === 'ECONNREFUSED';
      if ((is429 || isNetwork) && attempt < maxRetries) {
        const retryAfterMs = is429 ? getRetryAfterMs(e) : null;
        const backoffMs = 1500 + attempt * 1500;
        await sleep(Math.max(retryAfterMs ?? 0, backoffMs));
        continue;
      }
      throw e;
    }
  }
}

export async function tnPostWithRetry(
  axiosInstance: { post: (url: string, body: any, config: any) => Promise<any> },
  url: string,
  body: any,
  config: any,
  opts?: { maxRetries?: number; minIntervalMs?: number }
): Promise<any> {
  const maxRetries = Math.max(0, opts?.maxRetries ?? 4);
  const envInterval = parseInt(process.env.TN_RATE_LIMIT_DELAY_MS || '800', 10);
  const resolvedInterval = opts?.minIntervalMs ?? (Number.isFinite(envInterval) ? envInterval : 800);
  const minIntervalMs = Math.max(0, resolvedInterval);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await scheduleTn(() => axiosInstance.post(url, body, config), minIntervalMs);
    } catch (e: any) {
      const status = e?.response?.status;
      const is429 = status === 429;
      const isNetwork = e?.code === 'ECONNRESET' || e?.code === 'ETIMEDOUT' || e?.code === 'ECONNREFUSED';
      if ((is429 || isNetwork) && attempt < maxRetries) {
        const retryAfterMs = is429 ? getRetryAfterMs(e) : null;
        const backoffMs = 1500 + attempt * 1500;
        await sleep(Math.max(retryAfterMs ?? 0, backoffMs));
        continue;
      }
      throw e;
    }
  }
  throw new Error('tnPostWithRetry: retries exhausted');
}

export async function tnGetWithRetry<T = unknown>(
  axiosInstance: { get: (url: string, config: any) => Promise<{ data: T; status: number }> },
  url: string,
  config: any,
  opts?: { maxRetries?: number; minIntervalMs?: number }
): Promise<{ data: T; status: number }> {
  const maxRetries = Math.max(0, opts?.maxRetries ?? 4);
  const envInterval = parseInt(process.env.TN_RATE_LIMIT_DELAY_MS || '800', 10);
  const resolvedInterval = opts?.minIntervalMs ?? (Number.isFinite(envInterval) ? envInterval : 800);
  const minIntervalMs = Math.max(0, resolvedInterval);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await scheduleTn(() => axiosInstance.get(url, config), minIntervalMs);
    } catch (e: any) {
      const status = e?.response?.status;
      const is429 = status === 429;
      const isNetwork = e?.code === 'ECONNRESET' || e?.code === 'ETIMEDOUT' || e?.code === 'ECONNREFUSED';
      if ((is429 || isNetwork) && attempt < maxRetries) {
        const retryAfterMs = is429 ? getRetryAfterMs(e) : null;
        const backoffMs = 1500 + attempt * 1500;
        await sleep(Math.max(retryAfterMs ?? 0, backoffMs));
        continue;
      }
      throw e;
    }
  }
  throw new Error('tnGetWithRetry: retries exhausted');
}

export async function tnDeleteWithRetry(
  axiosInstance: { delete: (url: string, config: any) => Promise<any> },
  url: string,
  config: any,
  opts?: { maxRetries?: number; minIntervalMs?: number }
): Promise<void> {
  const maxRetries = Math.max(0, opts?.maxRetries ?? 4);
  const envInterval = parseInt(process.env.TN_RATE_LIMIT_DELAY_MS || '800', 10);
  const resolvedInterval = opts?.minIntervalMs ?? (Number.isFinite(envInterval) ? envInterval : 800);
  const minIntervalMs = Math.max(0, resolvedInterval);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await scheduleTn(() => axiosInstance.delete(url, config), minIntervalMs);
      return;
    } catch (e: any) {
      const status = e?.response?.status;
      const is429 = status === 429;
      const isNetwork = e?.code === 'ECONNRESET' || e?.code === 'ETIMEDOUT' || e?.code === 'ECONNREFUSED';
      if ((is429 || isNetwork) && attempt < maxRetries) {
        const retryAfterMs = is429 ? getRetryAfterMs(e) : null;
        const backoffMs = 1500 + attempt * 1500;
        await sleep(Math.max(retryAfterMs ?? 0, backoffMs));
        continue;
      }
      throw e;
    }
  }
}
