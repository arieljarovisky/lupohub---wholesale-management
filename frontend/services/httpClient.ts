import axios, { AxiosRequestConfig, Method } from 'axios';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

let baseUrl: string = (import.meta.env?.VITE_API_URL as string) || localStorage.getItem('lupo_api_base') || 'http://127.0.0.1:3010/api';

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
  (err) => {
    const status = err?.response?.status;
    const url = err?.config?.url;
    console.log('[api:error]', status, url, err?.message);
    if (status === 401) {
      try {
        localStorage.removeItem('lupo_api_token');
        authToken = null;
        console.warn('Token inválido. Se limpió el token y se requiere re-login.');
      } catch {}
    }
    return Promise.reject(err);
  }
);

export const setBaseUrl = (url: string) => {
  baseUrl = url;
  localStorage.setItem('lupo_api_base', url);
};

export const setAuthToken = (token: string | null) => {
  authToken = token;
  if (token) localStorage.setItem('lupo_api_token', token);
  else localStorage.removeItem('lupo_api_token');
};

const DEFAULT_TIMEOUT = 15000; // 15s

export const request = async <T = any>(path: string, method: HttpMethod = 'GET', body?: any, extraHeaders?: Record<string, string>, timeout = DEFAULT_TIMEOUT): Promise<T> => {
  const url = path.startsWith('http') ? path : `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;

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
