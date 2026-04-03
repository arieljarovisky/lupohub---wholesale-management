/**
 * Respuestas automáticas a preguntas de Mercado Libre con IA.
 * Proveedores soportados (configuración por .env):
 * - Google Gemini (GEMINI_API_KEY) — cuota gratuita en AI Studio
 * - Groq (GROQ_API_KEY) — tier gratuito, API compatible con OpenAI
 * - OpenAI (OPENAI_API_KEY) — de pago
 */
import axios from 'axios';
import { execute, get } from '../database/db';

const ML_API = 'https://api.mercadolibre.com';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const DEFAULT_SYSTEM = `Sos el asistente de un vendedor en Mercado Libre (Argentina).
Respondé en español rioplatense, de forma breve y cordial.
Reglas:
- Basá la respuesta SOLO en el título y la descripción del producto que te damos. No inventes datos.
- Si la pregunta es sobre stock, envíos, garantías, cambios o plazos y no está aclarado en la descripción, decí que no tenés ese dato en la publicación e invitá al comprador a que te escriba por el chat de la compra si ya compró, o que consulte en la publicación.
- No uses markdown ni emojis en exceso (como mucho uno).
- Máximo ~1200 caracteres. Sin listas largas.`;

export async function ensureMlQuestionsAiConfigTable(): Promise<void> {
  await execute(`
    CREATE TABLE IF NOT EXISTS ml_questions_ai_config (
      id INT PRIMARY KEY DEFAULT 1,
      enabled BOOLEAN DEFAULT 0,
      extra_system_prompt TEXT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

export async function getMlQuestionsAiConfigRow(): Promise<{ enabled: boolean; extraSystemPrompt: string | null }> {
  await ensureMlQuestionsAiConfigTable();
  const row = await get(`SELECT enabled, extra_system_prompt AS extraSystemPrompt FROM ml_questions_ai_config WHERE id = 1`);
  if (!row) {
    await execute(`INSERT INTO ml_questions_ai_config (id, enabled, extra_system_prompt) VALUES (1, 0, NULL)`);
    return { enabled: false, extraSystemPrompt: null };
  }
  return {
    enabled: row.enabled === 1 || row.enabled === true,
    extraSystemPrompt: row.extraSystemPrompt ?? null
  };
}

export async function saveMlQuestionsAiConfig(enabled: boolean, extraSystemPrompt: string | null): Promise<void> {
  await ensureMlQuestionsAiConfigTable();
  await execute(
    `INSERT INTO ml_questions_ai_config (id, enabled, extra_system_prompt)
     VALUES (1, ?, ?)
     ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), extra_system_prompt = VALUES(extra_system_prompt)`,
    [enabled ? 1 : 0, extraSystemPrompt?.trim() || null]
  );
}

function hasGeminiKey(): boolean {
  return !!(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
}
function hasGroqKey(): boolean {
  return !!(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim());
}
function hasOpenAiKey(): boolean {
  return !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim());
}

export type LlmProviderId = 'gemini' | 'groq' | 'openai';

/** Orden por defecto: primero opciones con tier gratuito. */
function resolveProvider(): LlmProviderId | null {
  const explicit = (process.env.LLM_PROVIDER || process.env.AI_PROVIDER || '').trim().toLowerCase();
  if (explicit === 'gemini' && hasGeminiKey()) return 'gemini';
  if (explicit === 'groq' && hasGroqKey()) return 'groq';
  if (explicit === 'openai' && hasOpenAiKey()) return 'openai';
  if (explicit) return null;

  if (hasGeminiKey()) return 'gemini';
  if (hasGroqKey()) return 'groq';
  if (hasOpenAiKey()) return 'openai';
  return null;
}

/** Compatibilidad: “hay algún LLM configurado”. */
export function openAiConfigured(): boolean {
  return resolveProvider() !== null;
}

export function llmConfigured(): boolean {
  return resolveProvider() !== null;
}

export function getLlmStatus(): {
  configured: boolean;
  provider: LlmProviderId | null;
  label: string;
} {
  const provider = resolveProvider();
  const labels: Record<LlmProviderId, string> = {
    gemini: 'Google Gemini (gratis en AI Studio)',
    groq: 'Groq (gratis)',
    openai: 'OpenAI (de pago)'
  };
  return {
    configured: provider !== null,
    provider,
    label: provider ? labels[provider] : 'Ninguna clave configurada'
  };
}

/** Modelo estable actual (Google dejó de exponer gemini-1.5-flash en v1beta para muchas cuentas). */
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_FALLBACK_MODELS = ['gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-flash-latest'] as const;

function isGeminiModelNotFound(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return false;
  if (err.response?.status === 404) return true;
  const e = err.response?.data as { error?: { status?: string } } | undefined;
  return e?.error?.status === 'NOT_FOUND';
}

function geminiModelAttempts(): string[] {
  const fromEnv = process.env.GEMINI_MODEL?.trim();
  const primary = fromEnv || DEFAULT_GEMINI_MODEL;
  const rest = GEMINI_FALLBACK_MODELS.filter((m) => m !== primary);
  return [primary, ...rest];
}

async function callGeminiAnswer(params: {
  itemTitle: string;
  description: string;
  questionText: string;
  extraSystem?: string | null;
}): Promise<string> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error('GEMINI_API_KEY no configurada');

  const system = [DEFAULT_SYSTEM, params.extraSystem?.trim()].filter(Boolean).join('\n\n');
  const user = `Título de la publicación:\n${params.itemTitle}\n\nDescripción (texto plano):\n${params.description || '(sin descripción)'}\n\nPregunta del comprador:\n${params.questionText}`;

  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 1024
    }
  };

  let lastErr: unknown;
  for (const model of geminiModelAttempts()) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
    try {
      const res = await axios.post(url, body, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 60000
      });

      const cand = res.data?.candidates?.[0];
      const block = cand?.finishReason && cand.finishReason !== 'STOP' ? ` (${cand.finishReason})` : '';
      const text =
        cand?.content?.parts?.map((p: { text?: string }) => p.text || '').join('')?.trim() || '';
      if (!text) throw new Error(`Gemini no devolvió texto${block}`);
      return truncateAnswer(text);
    } catch (err) {
      lastErr = err;
      if (isGeminiModelNotFound(err)) {
        console.warn(`[ML Questions AI] Modelo Gemini no disponible (${model}), probando siguiente…`);
        continue;
      }
      throw err;
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error('Gemini: sin modelo disponible');
}

async function callGroqAnswer(params: {
  itemTitle: string;
  description: string;
  questionText: string;
  extraSystem?: string | null;
}): Promise<string> {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) throw new Error('GROQ_API_KEY no configurada');

  const model = process.env.GROQ_MODEL?.trim() || 'llama-3.1-8b-instant';
  const system = [DEFAULT_SYSTEM, params.extraSystem?.trim()].filter(Boolean).join('\n\n');
  const user = `Título de la publicación:\n${params.itemTitle}\n\nDescripción (texto plano):\n${params.description || '(sin descripción)'}\n\nPregunta del comprador:\n${params.questionText}`;

  const res = await axios.post(
    GROQ_URL,
    {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.4,
      max_tokens: 700
    },
    {
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    }
  );

  const text = res.data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Groq no devolvió texto');
  return truncateAnswer(text);
}

async function callOpenAiAnswer(params: {
  itemTitle: string;
  description: string;
  questionText: string;
  extraSystem?: string | null;
}): Promise<string> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error('OPENAI_API_KEY no configurada en el servidor');

  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
  const system = [DEFAULT_SYSTEM, params.extraSystem?.trim()].filter(Boolean).join('\n\n');

  const user = `Título de la publicación:\n${params.itemTitle}\n\nDescripción (texto plano):\n${params.description || '(sin descripción)'}\n\nPregunta del comprador:\n${params.questionText}`;

  const res = await axios.post(
    OPENAI_URL,
    {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.4,
      max_tokens: 700
    },
    {
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    }
  );

  const text = res.data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('OpenAI no devolvió texto');
  return truncateAnswer(text);
}

async function generateLlmAnswer(params: {
  itemTitle: string;
  description: string;
  questionText: string;
  extraSystem?: string | null;
}): Promise<string> {
  const provider = resolveProvider();
  if (!provider) {
    throw new Error(
      'Ningún proveedor de IA configurado. Agregá GEMINI_API_KEY (recomendado, gratis), GROQ_API_KEY (gratis) u OPENAI_API_KEY en el servidor.'
    );
  }
  if (provider === 'gemini') return callGeminiAnswer(params);
  if (provider === 'groq') return callGroqAnswer(params);
  return callOpenAiAnswer(params);
}

function truncateAnswer(s: string, max = 1900): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 3) + '...';
}

type MLToken = { access_token: string; user_id: string };

async function mlGet(accessToken: string, path: string, query?: Record<string, string | number | undefined>) {
  return axios.get(`${ML_API}${path}`, {
    params: { api_version: 4, ...query },
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 45000
  });
}

async function mlPost(accessToken: string, path: string, body: unknown) {
  return axios.post(`${ML_API}${path}`, body, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    timeout: 45000
  });
}

/** Obtiene una pregunta por ID. */
export async function fetchQuestion(accessToken: string, questionId: string) {
  const res = await mlGet(accessToken, `/questions/${questionId}`);
  return res.data;
}

/** Lista preguntas sin responder del vendedor. */
export async function searchUnansweredQuestions(accessToken: string, sellerId: string, limit = 20) {
  const res = await mlGet(accessToken, `/questions/search`, {
    seller_id: sellerId,
    status: 'UNANSWERED',
    limit: Math.min(Math.max(limit, 1), 50)
  });
  return res.data as { questions?: any[]; total?: number };
}

async function fetchItem(accessToken: string, itemId: string) {
  const res = await mlGet(accessToken, `/items/${encodeURIComponent(itemId)}`);
  return res.data;
}

async function fetchDescription(accessToken: string, itemId: string): Promise<string> {
  try {
    const res = await mlGet(accessToken, `/items/${encodeURIComponent(itemId)}/description`);
    const plain = res.data?.plain_text ?? res.data?.text ?? '';
    return typeof plain === 'string' ? plain : '';
  } catch {
    return '';
  }
}

function isQuestionUnanswered(q: any): boolean {
  const st = String(q?.status || '').toUpperCase();
  if (st === 'ANSWERED') return false;
  if (q?.answer && String(q.answer?.status || '').toUpperCase() === 'ACTIVE') return false;
  return true;
}

export type ProcessOneResult =
  | { questionId: string; status: 'skipped'; reason: string }
  | { questionId: string; status: 'answered'; preview: string }
  | { questionId: string; status: 'error'; message: string };

export async function processOneQuestion(
  accessToken: string,
  questionId: string,
  opts?: { extraSystemPrompt?: string | null }
): Promise<ProcessOneResult> {
  const q = await fetchQuestion(accessToken, questionId);
  if (!isQuestionUnanswered(q)) {
    return { questionId, status: 'skipped', reason: 'Ya respondida o cerrada' };
  }

  const itemId = q.item_id;
  const questionText = String(q.text || '').trim();
  if (!questionText) {
    return { questionId, status: 'skipped', reason: 'Pregunta vacía' };
  }

  const item = await fetchItem(accessToken, itemId);
  const title = String(item?.title || '(sin título)');
  const description = await fetchDescription(accessToken, itemId);

  const answerText = await generateLlmAnswer({
    itemTitle: title,
    description,
    questionText,
    extraSystem: opts?.extraSystemPrompt
  });

  await mlPost(accessToken, '/answers', {
    question_id: Number(questionId),
    text: answerText
  });

  return { questionId, status: 'answered', preview: answerText.slice(0, 160) };
}

export async function processUnansweredBatch(
  mlToken: MLToken,
  opts?: { limit?: number; extraSystemPrompt?: string | null }
): Promise<{ processed: number; results: ProcessOneResult[] }> {
  const limit = Math.min(Math.max(opts?.limit ?? 10, 1), 25);
  const search = await searchUnansweredQuestions(mlToken.access_token, mlToken.user_id, limit);
  const questions = search.questions || [];
  const results: ProcessOneResult[] = [];

  for (const q of questions.slice(0, limit)) {
    const id = String(q?.id ?? '');
    if (!id) continue;
    try {
      const r = await processOneQuestion(mlToken.access_token, id, {
        extraSystemPrompt: opts?.extraSystemPrompt
      });
      results.push(r);
      await new Promise((r) => setTimeout(r, 400));
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.response?.data?.error || e?.message || String(e);
      results.push({ questionId: id, status: 'error', message: String(msg) });
    }
  }

  return { processed: results.length, results };
}

/** Si la configuración y OpenAI están activos, procesa preguntas sin responder (para webhook o cron). */
export async function runMlQuestionsAiIfEnabled(
  getToken: () => Promise<MLToken | null>,
  opts?: { limit?: number }
): Promise<{ ran: boolean; message?: string; processed?: number; results?: ProcessOneResult[] }> {
  const cfg = await getMlQuestionsAiConfigRow();
  if (!cfg.enabled) {
    return { ran: false, message: 'Auto-respuesta desactivada' };
  }
  if (!llmConfigured()) {
    return { ran: false, message: 'Ninguna clave de IA configurada (GEMINI_API_KEY, GROQ_API_KEY u OPENAI_API_KEY)' };
  }
  const token = await getToken();
  if (!token) {
    return { ran: false, message: 'Sin token de Mercado Libre' };
  }
  const { processed, results } = await processUnansweredBatch(token, {
    limit: opts?.limit ?? 5,
    extraSystemPrompt: cfg.extraSystemPrompt
  });
  return { ran: true, processed, results };
}
