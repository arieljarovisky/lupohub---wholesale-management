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
      
      const errorData = err.response?.data;
      const errorMessage = errorData?.message || errorData || err.message;
      
      throw new Error(typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage));
    }
    throw err;
  }
};

export default { request, setBaseUrl, setAuthToken };
