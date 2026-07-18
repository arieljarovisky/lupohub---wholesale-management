import axios, { AxiosRequestConfig, Method } from 'axios';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Asegura que la URL base tenga protocolo para que no se trate como ruta relativa (ej. en Vercel). */
function normalizeBaseUrl(url: string): string {
  const u = (url || '').trim();
  if (!u) return 'http://127.0.0.1:3010/api';
  if (u.startsWith('http://') || u.startsWith('https://')) return u.replace(/\/$/, '');
  return `https://${u.replace(/\/$/, '')}`;
}

const stored = (import.meta.env?.VITE_API_URL as string) || localStorage.getItem('lupo_api_base') || 'http://127.0.0.1:3010/api';
let baseUrl: string = normalizeBaseUrl(stored);

console.log('🔌 API Base URL:', baseUrl);
let authToken: string | null = localStorage.getItem('lupo_api_token') || null;

axios.interceptors.request.use((config) => {
  const m = (config.method || 'GET').toString().toUpperCase();
  console.log('[api]', m, config.url);
  return config;
});
axios.interceptors.response.use(
  (res) => {
    console.log('[api:ok]', res.status, res.config.url);
    return res;
  },
  async (err) => {
    const status = err?.response?.status;
    const url = err?.config?.url;
    console.log('[api:error]', status, url, err?.message);
    const config = err?.config;
    const isRefreshRequest = typeof url === 'string' && url.includes('/auth/refresh');
    const alreadyRetried = (config as any)?._retried === true;
    if (status === 401 && !isRefreshRequest && !alreadyRetried && authToken) {
      try {
        const refreshUrl = `${baseUrl}/auth/refresh`;
        const refreshRes = await axios.post(refreshUrl, {}, {
          headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
          timeout: 10000
        });
        const newToken = refreshRes?.data?.token;
        if (newToken) {
          authToken = newToken;
          localStorage.setItem('lupo_api_token', newToken);
          (config as any)._retried = true;
          config.headers = config.headers || {};
          config.headers['Authorization'] = `Bearer ${newToken}`;
          return axios(config);
        }
      } catch (_) {
        /* refresh falló */
      }
    }
    if (status === 401) {
      try {
        localStorage.removeItem('lupo_api_token');
        authToken = null;
        console.warn('Token inválido o no se pudo renovar. Se requiere volver a iniciar sesión.');
      } catch {}
    }
    return Promise.reject(err);
  }
);

export const setBaseUrl = (url: string) => {
  baseUrl = normalizeBaseUrl(url);
  localStorage.setItem('lupo_api_base', baseUrl);
};

export const setAuthToken = (token: string | null) => {
  authToken = token;
  if (token) localStorage.setItem('lupo_api_token', token);
  else localStorage.removeItem('lupo_api_token');
};

const DEFAULT_TIMEOUT = 15000; // 15s

export const request = async <T = any>(path: string, method: HttpMethod = 'GET', body?: any, extraHeaders?: Record<string, string>, timeout = DEFAULT_TIMEOUT): Promise<T> => {
  const url = path.startsWith('http') ? path : `${baseUrl}/${path.replace(/^\//, '')}`;

  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    ...extraHeaders,
  };

  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  const config: AxiosRequestConfig = {
    method: method as Method,
    url,
    headers,
    data: body,
    timeout,
  };

  try {
    const response = await axios(config);
    return response.data;
  } catch (err: any) {
    if (axios.isAxiosError(err)) {
      if (err.code === 'ECONNABORTED') throw new Error('Request timed out');

      if (!err.response) {
        const isGateway =
          String(err.message || '').toLowerCase().includes('network error') ||
          err.code === 'ERR_NETWORK';
        if (isGateway) {
          const urlHint = String(config?.url || path || '');
          const isAfip =
            /afip|arca|invoice|factur|comprobante|cae/i.test(urlHint);
          throw new Error(
            isAfip
              ? 'No hubo respuesta del servidor (error de red o tiempo de espera del hosting). En facturación AFIP suele ser ARCA lento o un corte del proxy (~60s). Reintentá en unos minutos y verificá en AFIP si el comprobante se emitió antes de volver a intentar.'
              : 'No hubo respuesta del servidor (error de red o corte del proxy ~60s). Si estabas sincronizando stock, el backend puede seguir trabajando: esperá unos minutos y revisá ML/TN o los logs.'
          );
        }
      }

      const errorData = err.response?.data;
      // Backend puede enviar { message: "..." } o { error: "..." }
      const serverMsg =
        (typeof errorData?.message === 'string' && errorData.message) ||
        (typeof errorData?.error === 'string' && errorData.error) ||
        (typeof errorData === 'string' && errorData);
      const errorMessage = serverMsg || err.message;

      throw new Error(errorMessage);
    }
    throw err;
  }
};

/** POST con FormData (para subir archivos). No setea Content-Type. */
export const requestFormData = async <T = any>(path: string, formData: FormData, timeout = 60000): Promise<T> => {
  const url = path.startsWith('http') ? path : `${baseUrl}/${path.replace(/^\//, '')}`;
  const headers: Record<string, string> = { 'Accept': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  const response = await axios.post(url, formData, { headers, timeout });
  return response.data;
};

/** GET que devuelve Blob (para descargar/ver archivos con auth). */
export const getBlob = async (path: string, timeoutMs = 60000): Promise<Blob> => {
  const url = path.startsWith('http') ? path : `${baseUrl}/${path.replace(/^\//, '')}`;
  const headers: Record<string, string> = {};
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  try {
    const response = await axios.get(url, { responseType: 'blob', headers, timeout: timeoutMs });
    return response.data;
  } catch (err: any) {
    if (axios.isAxiosError(err)) {
      const blob = err.response?.data;
      if (blob instanceof Blob) {
        try {
          const raw = await blob.text();
          const parsed = raw ? JSON.parse(raw) : null;
          const msg =
            (typeof parsed?.message === 'string' && parsed.message) ||
            (typeof parsed?.error === 'string' && parsed.error) ||
            '';
          if (msg) throw new Error(msg);
        } catch {
          // ignore parse errors and use fallback message
        }
      }
      throw new Error(err.message || 'Error descargando archivo');
    }
    throw err;
  }
};

/** GET que devuelve Blob + headers (para respetar filename del backend). */
export const getBlobResponse = async (
  path: string,
  timeoutMs = 60000
): Promise<{ blob: Blob; headers: Record<string, string | undefined> }> => {
  const url = path.startsWith('http') ? path : `${baseUrl}/${path.replace(/^\//, '')}`;
  const headers: Record<string, string> = {};
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  const response = await axios.get(url, { responseType: 'blob', headers, timeout: timeoutMs });
  return { blob: response.data, headers: response.headers as Record<string, string | undefined> };
};

/** POST que devuelve Blob (para descargar archivos con body + auth). */
export const postBlob = async (path: string, body?: any, timeoutMs = 120000): Promise<Blob> => {
  const url = path.startsWith('http') ? path : `${baseUrl}/${path.replace(/^\//, '')}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream,*/*'
  };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  const response = await axios.post(url, body ?? {}, { responseType: 'blob', headers, timeout: timeoutMs });
  return response.data;
};

/** POST con FormData que devuelve Blob (descargas con archivo de entrada). */
export const postFormDataBlob = async (path: string, formData: FormData, timeoutMs = 120000): Promise<Blob> => {
  const url = path.startsWith('http') ? path : `${baseUrl}/${path.replace(/^\//, '')}`;
  const headers: Record<string, string> = { Accept: '*/*' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  try {
    const response = await axios.post(url, formData, { responseType: 'blob', headers, timeout: timeoutMs });
    return response.data;
  } catch (err: any) {
    if (axios.isAxiosError(err)) {
      const blob = err.response?.data;
      if (blob instanceof Blob) {
        try {
          const raw = await blob.text();
          const parsed = raw ? JSON.parse(raw) : null;
          const msg =
            (typeof parsed?.message === 'string' && parsed.message) ||
            (typeof parsed?.error === 'string' && parsed.error) ||
            '';
          if (msg) throw new Error(msg);
        } catch {
          // ignorar parse y usar mensaje genérico
        }
      }
      throw new Error(err.message || 'Error descargando archivo');
    }
    throw err;
  }
};

export const getBaseUrl = () => baseUrl;

export default { request, requestFormData, getBlob, getBlobResponse, postBlob, postFormDataBlob, setBaseUrl, setAuthToken };
