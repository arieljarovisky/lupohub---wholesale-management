/**
 * Respuestas automáticas a preguntas de Mercado Libre con IA.
 * Proveedores soportados (configuración por .env):
 * - Google Gemini (GEMINI_API_KEY) — cuota gratuita en AI Studio
 * - Groq (GROQ_API_KEY) — tier gratuito, API compatible con OpenAI
 * - OpenAI (OPENAI_API_KEY) — de pago
 */
import axios from 'axios';
import { execute, get, query } from '../database/db';

const ML_API = 'https://api.mercadolibre.com';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const DEFAULT_SYSTEM = `Sos el asistente de un vendedor en Mercado Libre (Argentina).
Respondé en español rioplatense, de forma breve y cordial.
Reglas:
- Fuentes de la publicación: (1) Si en el prompt aparece "Guía de talles (Mercado Libre)", es la tabla oficial cargada en ML para ESA publicación: usala como referencia principal para M/G/medidas en cm. (2) Título y descripción (texto de la ficha). (3) El bloque "Catálogo LupoHub" es inventario interno (SKU, talle, color, stock, vínculos ML). Usá el catálogo para alternativas de modelo/color/stock cuando el comprador pida opciones.
- Priorizá la guía de talles de ML (cuando exista) sobre suposiciones genéricas; cruzá con la descripción y el catálogo si hace falta.
- Preguntas de talle/medidas (M vs G, cm de cadera, etc.): primero la guía de talles ML; si no hay guía en el prompt, usá tabla o rangos en la descripción y variantes del catálogo. Relacioná medidas del comprador con filas de la guía (cadera, contorno, etc.). No te cortes a mitad de frase: si recomendás un talle, decí cuál y en una oración por qué. Si falta un dato imprescindible, pedilo o compará opciones sin dejar la respuesta inconclusa.
- Si el comprador pregunta por "más grande", "más chico", "más elástico", "otro talle", "otro modelo" o similares, revisá el catálogo y:
  1) confirmá si existe alguna alternativa real,
  2) mencioná hasta 3 opciones concretas (nombre/SKU/talle/color) que sí estén en catálogo,
  3) si no hay alternativas, decilo claramente.
- Cuando afirmes que "sí hay", apoyate en datos visibles del catálogo. No inventes productos ni talles.
- Si algo no figura en la guía de talles, la descripción ni el catálogo (envíos, garantías, plazos, políticas), no inventes: decí que no tenés ese dato y ofrecé canalizar por mensaje de compra o consulta en la publicación.
- No uses markdown ni emojis en exceso (como mucho uno).
- Máximo ~1200 caracteres. Sin listas largas. Siempre cerrá oraciones: la respuesta debe ser un texto completo y útil, nunca truncada a mitad de idea.`;

/** off = desactivado | suggest = genera sugerencias para revisión | auto = responde solo */
export type MlQuestionsAiMode = 'off' | 'suggest' | 'auto';

export type MlQuestionsAiSuggestionStatus = 'pending' | 'sent' | 'rejected';

export type MlQuestionsAiSuggestionRow = {
  questionId: string;
  itemId: string | null;
  questionText: string | null;
  suggestionText: string;
  status: MlQuestionsAiSuggestionStatus;
  llmProvider: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export async function ensureMlQuestionsAiConfigTable(): Promise<void> {
  await execute(`
    CREATE TABLE IF NOT EXISTS ml_questions_ai_config (
      id INT PRIMARY KEY DEFAULT 1,
      enabled BOOLEAN DEFAULT 0,
      mode VARCHAR(16) DEFAULT 'off',
      extra_system_prompt TEXT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  try {
    await execute(`ALTER TABLE ml_questions_ai_config ADD COLUMN mode VARCHAR(16) DEFAULT 'off'`);
  } catch {
    /* columna ya existe */
  }
}

export async function ensureMlQuestionsAiSuggestionsTable(): Promise<void> {
  await execute(`
    CREATE TABLE IF NOT EXISTS ml_questions_ai_suggestions (
      question_id VARCHAR(64) PRIMARY KEY,
      item_id VARCHAR(64) NULL,
      question_text TEXT NULL,
      suggestion_text TEXT NOT NULL,
      status VARCHAR(16) DEFAULT 'pending',
      llm_provider VARCHAR(32) NULL,
      sent_text TEXT NULL,
      was_edited TINYINT NULL,
      sent_source VARCHAR(16) NULL,
      sent_at DATETIME NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  for (const col of [
    'sent_text TEXT NULL',
    'was_edited TINYINT NULL',
    'sent_source VARCHAR(16) NULL',
    'sent_at DATETIME NULL'
  ]) {
    try {
      await execute(`ALTER TABLE ml_questions_ai_suggestions ADD COLUMN ${col}`);
    } catch {
      /* columna ya existe */
    }
  }
}

function normalizeMode(raw: unknown, enabledFallback?: boolean): MlQuestionsAiMode {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'suggest' || s === 'auto' || s === 'off') return s;
  if (enabledFallback === true) return 'auto';
  return 'off';
}

export async function getMlQuestionsAiConfigRow(): Promise<{
  enabled: boolean;
  mode: MlQuestionsAiMode;
  extraSystemPrompt: string | null;
}> {
  await ensureMlQuestionsAiConfigTable();
  const row = await get(
    `SELECT enabled, mode, extra_system_prompt AS extraSystemPrompt FROM ml_questions_ai_config WHERE id = 1`
  );
  if (!row) {
    await execute(`INSERT INTO ml_questions_ai_config (id, enabled, mode, extra_system_prompt) VALUES (1, 0, 'off', NULL)`);
    return { enabled: false, mode: 'off', extraSystemPrompt: null };
  }
  const enabled = row.enabled === 1 || row.enabled === true;
  const mode = normalizeMode(row.mode, enabled);
  return {
    enabled: mode !== 'off',
    mode,
    extraSystemPrompt: row.extraSystemPrompt ?? null
  };
}

export async function saveMlQuestionsAiConfig(params: {
  enabled?: boolean;
  mode?: MlQuestionsAiMode;
  extraSystemPrompt?: string | null;
}): Promise<void> {
  await ensureMlQuestionsAiConfigTable();
  const current = await getMlQuestionsAiConfigRow();
  let mode = params.mode ?? current.mode;
  if (params.enabled != null && params.mode == null) {
    mode = params.enabled ? (current.mode === 'off' ? 'auto' : current.mode) : 'off';
  }
  if (mode !== 'off' && mode !== 'suggest' && mode !== 'auto') mode = 'off';
  const enabled = mode !== 'off';
  const extra = params.extraSystemPrompt !== undefined ? params.extraSystemPrompt?.trim() || null : current.extraSystemPrompt;
  await execute(
    `INSERT INTO ml_questions_ai_config (id, enabled, mode, extra_system_prompt)
     VALUES (1, ?, ?, ?)
     ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), mode = VALUES(mode), extra_system_prompt = VALUES(extra_system_prompt)`,
    [enabled ? 1 : 0, mode, extra]
  );
}

function mapSuggestionRow(row: any): MlQuestionsAiSuggestionRow {
  return {
    questionId: String(row.questionId ?? row.question_id),
    itemId: row.itemId ?? row.item_id ?? null,
    questionText: row.questionText ?? row.question_text ?? null,
    suggestionText: String(row.suggestionText ?? row.suggestion_text ?? ''),
    status: (row.status || 'pending') as MlQuestionsAiSuggestionStatus,
    llmProvider: row.llmProvider ?? row.llm_provider ?? null,
    createdAt: row.createdAt ?? row.created_at ?? null,
    updatedAt: row.updatedAt ?? row.updated_at ?? null
  };
}

export async function getSuggestionByQuestionId(questionId: string): Promise<MlQuestionsAiSuggestionRow | null> {
  await ensureMlQuestionsAiSuggestionsTable();
  const row = await get(
    `SELECT question_id AS questionId, item_id AS itemId, question_text AS questionText,
            suggestion_text AS suggestionText, status, llm_provider AS llmProvider,
            created_at AS createdAt, updated_at AS updatedAt
     FROM ml_questions_ai_suggestions WHERE question_id = ?`,
    [questionId]
  );
  return row ? mapSuggestionRow(row) : null;
}

export async function getSuggestionsByQuestionIds(ids: string[]): Promise<Map<string, MlQuestionsAiSuggestionRow>> {
  await ensureMlQuestionsAiSuggestionsTable();
  const map = new Map<string, MlQuestionsAiSuggestionRow>();
  const clean = [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))];
  if (!clean.length) return map;
  const placeholders = clean.map(() => '?').join(',');
  const rows = await query(
    `SELECT question_id AS questionId, item_id AS itemId, question_text AS questionText,
            suggestion_text AS suggestionText, status, llm_provider AS llmProvider,
            created_at AS createdAt, updated_at AS updatedAt
     FROM ml_questions_ai_suggestions WHERE question_id IN (${placeholders})`,
    clean
  );
  for (const row of rows as any[]) {
    const s = mapSuggestionRow(row);
    map.set(s.questionId, s);
  }
  return map;
}

async function upsertSuggestion(params: {
  questionId: string;
  itemId?: string | null;
  questionText?: string | null;
  suggestionText: string;
  status?: MlQuestionsAiSuggestionStatus;
  llmProvider?: string | null;
}): Promise<void> {
  await ensureMlQuestionsAiSuggestionsTable();
  await execute(
    `INSERT INTO ml_questions_ai_suggestions
       (question_id, item_id, question_text, suggestion_text, status, llm_provider)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       item_id = VALUES(item_id),
       question_text = VALUES(question_text),
       suggestion_text = VALUES(suggestion_text),
       status = VALUES(status),
       llm_provider = VALUES(llm_provider)`,
    [
      params.questionId,
      params.itemId ?? null,
      params.questionText ?? null,
      params.suggestionText,
      params.status ?? 'pending',
      params.llmProvider ?? null
    ]
  );
}

export async function rejectSuggestion(questionId: string): Promise<void> {
  await ensureMlQuestionsAiSuggestionsTable();
  await execute(`UPDATE ml_questions_ai_suggestions SET status = 'rejected' WHERE question_id = ?`, [questionId]);
}

function normalizeTextForCompare(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

async function recordSuggestionSent(
  questionId: string,
  params: { sentText: string; originalSuggestionText?: string | null; sentSource: 'review' | 'auto' }
): Promise<void> {
  await ensureMlQuestionsAiSuggestionsTable();
  let wasEdited: number | null = null;
  if (params.sentSource === 'review' && params.originalSuggestionText != null) {
    wasEdited =
      normalizeTextForCompare(params.originalSuggestionText) === normalizeTextForCompare(params.sentText) ? 0 : 1;
  }
  const existing = await get(`SELECT question_id FROM ml_questions_ai_suggestions WHERE question_id = ?`, [questionId]);
  if (!existing) {
    await execute(
      `INSERT INTO ml_questions_ai_suggestions
         (question_id, suggestion_text, status, sent_text, was_edited, sent_source, sent_at)
       VALUES (?, ?, 'sent', ?, ?, ?, NOW())`,
      [
        questionId,
        params.originalSuggestionText ?? params.sentText,
        params.sentText,
        wasEdited,
        params.sentSource
      ]
    );
    return;
  }
  await execute(
    `UPDATE ml_questions_ai_suggestions
     SET status = 'sent', sent_text = ?, was_edited = ?, sent_source = ?, sent_at = NOW()
     WHERE question_id = ?`,
    [params.sentText, wasEdited, params.sentSource, questionId]
  );
}

export type MlQuestionsAiMetrics = {
  totalGenerated: number;
  pending: number;
  sentUnchanged: number;
  sentEdited: number;
  rejected: number;
  autoSent: number;
  reviewSentTotal: number;
  unchangedRate: number | null;
  minReviewSendsForReady: number;
  readyRateThreshold: number;
  readyForAuto: boolean;
  recommendation: string;
};

function metricsReadyThresholds(): { minSends: number; rate: number } {
  const minSends = Math.max(
    5,
    parseInt(process.env.ML_QUESTIONS_AI_AUTO_READY_MIN_SENDS || '15', 10) || 15
  );
  const ratePct = parseFloat(process.env.ML_QUESTIONS_AI_AUTO_READY_RATE || '85') || 85;
  const rate = Math.min(100, Math.max(50, ratePct)) / 100;
  return { minSends, rate };
}

export async function getMlQuestionsAiMetrics(): Promise<MlQuestionsAiMetrics> {
  await ensureMlQuestionsAiSuggestionsTable();
  const row = await get(`
    SELECT
      COUNT(*) AS totalGenerated,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'sent' AND sent_source = 'review' AND was_edited = 0 THEN 1 ELSE 0 END) AS sentUnchanged,
      SUM(CASE WHEN status = 'sent' AND sent_source = 'review' AND was_edited = 1 THEN 1 ELSE 0 END) AS sentEdited,
      SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
      SUM(CASE WHEN status = 'sent' AND sent_source = 'auto' THEN 1 ELSE 0 END) AS autoSent
    FROM ml_questions_ai_suggestions
  `);
  const totalGenerated = Number(row?.totalGenerated) || 0;
  const pending = Number(row?.pending) || 0;
  const sentUnchanged = Number(row?.sentUnchanged) || 0;
  const sentEdited = Number(row?.sentEdited) || 0;
  const rejected = Number(row?.rejected) || 0;
  const autoSent = Number(row?.autoSent) || 0;
  const reviewSentTotal = sentUnchanged + sentEdited;
  const unchangedRate = reviewSentTotal > 0 ? Math.round((sentUnchanged / reviewSentTotal) * 1000) / 10 : null;
  const { minSends, rate } = metricsReadyThresholds();
  const readyForAuto = reviewSentTotal >= minSends && unchangedRate != null && unchangedRate / 100 >= rate;

  let recommendation: string;
  if (reviewSentTotal === 0) {
    recommendation =
      'Todavía no hay respuestas enviadas tras revisión. Usá modo sugerencias y aprobá algunas preguntas para medir la calidad.';
  } else if (reviewSentTotal < minSends) {
    recommendation = `Llevás ${reviewSentTotal} envío(s) revisado(s). Con ${minSends} o más podremos recomendar el modo automático.`;
  } else if (readyForAuto) {
    recommendation = `El ${unchangedRate}% se envió sin editar. Buen momento para probar respuesta automática.`;
  } else if (unchangedRate != null && unchangedRate >= 70) {
    recommendation = `El ${unchangedRate}% se envió sin editar. Cerca del objetivo (${Math.round(rate * 100)}%). Revisá las que editaste y ajustá el prompt si hace falta.`;
  } else {
    recommendation = `Solo el ${unchangedRate ?? 0}% se envió sin editar. Seguí en modo sugerencias y refiná las instrucciones extra de la IA.`;
  }

  return {
    totalGenerated,
    pending,
    sentUnchanged,
    sentEdited,
    rejected,
    autoSent,
    reviewSentTotal,
    unchangedRate,
    minReviewSendsForReady: minSends,
    readyRateThreshold: Math.round(rate * 100),
    readyForAuto,
    recommendation
  };
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

function ollamaBaseUrl(): string {
  const raw = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').trim();
  return raw.replace(/\/$/, '');
}

function hasOllama(): boolean {
  const explicit = (process.env.LLM_PROVIDER || process.env.AI_PROVIDER || '').trim().toLowerCase() === 'ollama';
  if (explicit) return true;
  return !!(process.env.OLLAMA_BASE_URL && process.env.OLLAMA_BASE_URL.trim());
}

export type LlmProviderId = 'gemini' | 'groq' | 'openai' | 'ollama';

/** Orden por defecto: primero opciones con tier gratuito en la nube; Ollama si es el único configurado. */
function resolveProvider(): LlmProviderId | null {
  const explicit = (process.env.LLM_PROVIDER || process.env.AI_PROVIDER || '').trim().toLowerCase();
  if (explicit === 'ollama' && hasOllama()) return 'ollama';
  if (explicit === 'gemini' && hasGeminiKey()) return 'gemini';
  if (explicit === 'groq' && hasGroqKey()) return 'groq';
  if (explicit === 'openai' && hasOpenAiKey()) return 'openai';
  if (explicit) return null;

  if (hasGeminiKey()) return 'gemini';
  if (hasGroqKey()) return 'groq';
  if (hasOpenAiKey()) return 'openai';
  if (hasOllama()) return 'ollama';
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
    openai: 'OpenAI (de pago)',
    ollama: `Ollama local (${process.env.OLLAMA_MODEL?.trim() || 'llama3.2'})`
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

const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
let catalogCache: { text: string; at: number } | null = null;

function catalogEnabled(): boolean {
  const v = (process.env.ML_QUESTIONS_AI_CATALOG_ENABLED || 'true').trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'no';
}

function maxCatalogRows(): number {
  const n = parseInt(process.env.ML_QUESTIONS_AI_CATALOG_MAX_ROWS || '600', 10);
  return Math.min(5000, Math.max(50, Number.isFinite(n) ? n : 600));
}

function maxCatalogChars(): number {
  const n = parseInt(process.env.ML_QUESTIONS_AI_CATALOG_MAX_CHARS || '14000', 10);
  return Math.min(100000, Math.max(2000, Number.isFinite(n) ? n : 14000));
}

/** Resumen de variantes en LupoHub para contexto de IA (preguntas ML). */
export async function buildLocalCatalogSummaryForMlQuestions(): Promise<string> {
  if (!catalogEnabled()) return '';
  try {
    const limit = maxCatalogRows();
    const rows = await query(
      `SELECT
         p.name AS product_name,
         p.category,
         p.sku AS base_sku,
         COALESCE(NULLIF(TRIM(pv.external_sku), ''), NULLIF(TRIM(pv.sku), '')) AS variant_sku,
         sz.size_code AS size_code,
         COALESCE(sz.name, '') AS size_name,
         c.name AS color_name,
         COALESCE(st.stock, 0) AS stock,
         p.mercado_libre_id AS ml_product,
         pv.mercado_libre_item_id AS ml_variant_item
       FROM products p
       INNER JOIN product_colors pc ON pc.product_id = p.id
       INNER JOIN product_variants pv ON pv.product_color_id = pc.id
       LEFT JOIN sizes sz ON sz.id = pv.size_id
       LEFT JOIN colors c ON c.id = pc.color_id
       LEFT JOIN stocks st ON st.variant_id = pv.id
       ORDER BY p.name ASC, variant_sku ASC
       LIMIT ?`,
      [limit]
    );

    if (!rows?.length) {
      return '(No hay variantes cargadas en LupoHub.)';
    }

    const lines: string[] = [];
    for (const r of rows as any[]) {
      const sku = (r.variant_sku || r.base_sku || '—').toString().trim();
      const talle = [r.size_code, r.size_name].filter(Boolean).join(' ').trim() || '—';
      const color = (r.color_name || '—').toString();
      const ml = (r.ml_variant_item || r.ml_product || '').toString().trim();
      const mlBit = ml ? ` | ML:${ml}` : '';
      lines.push(
        `- ${sku} | ${String(r.product_name || '').trim()} | Cat:${r.category || '—'} | Talle:${talle} | Color:${color} | Stock:${Number(r.stock) || 0}${mlBit}`
      );
    }

    let text = lines.join('\n');
    const maxC = maxCatalogChars();
    let truncated = false;
    if (text.length > maxC) {
      text = text.slice(0, maxC - 60) + '\n… (catálogo truncado por límite de contexto)';
      truncated = true;
    }
    const head = `Listado de ${rows.length} variantes en LupoHub${truncated ? ' (parcial)' : ''}:\n`;
    return head + text;
  } catch (e: any) {
    console.warn('[ML Questions AI] Catálogo local:', e?.message || e);
    return '(No se pudo cargar el catálogo LupoHub.)';
  }
}

async function getCachedCatalogSummary(): Promise<string> {
  if (!catalogEnabled()) return '';
  const now = Date.now();
  if (catalogCache && now - catalogCache.at < CATALOG_CACHE_TTL_MS) {
    return catalogCache.text;
  }
  const text = await buildLocalCatalogSummaryForMlQuestions();
  catalogCache = { text, at: now };
  return text;
}

const ML_SIZE_CHART_MAX_CHARS = 14000;

function buildMlQuestionUserPrompt(params: {
  catalogSummary: string;
  itemListingId: string;
  itemTitle: string;
  description: string;
  sizeGuideFromMl: string;
  questionText: string;
}): string {
  const cat = params.catalogSummary?.trim();
  const catBlock = cat
    ? `Catálogo LupoHub (inventario interno; puede estar incompleto o truncado):\n${cat}\n\n---\n\n`
    : '';
  const guide = params.sizeGuideFromMl?.trim();
  const guideBlock = guide
    ? `Guía de talles (Mercado Libre, publicación actual):\n${guide}\n\n---\n\n`
    : '';
  return (
    `${catBlock}` +
    `Publicación de Mercado Libre donde está la pregunta (ID ítem: ${params.itemListingId}):\n` +
    `Título: ${params.itemTitle}\n\n` +
    `${guideBlock}` +
    `Descripción (texto plano):\n${params.description || '(sin descripción)'}\n\n` +
    `Pregunta del comprador:\n${params.questionText}`
  );
}

async function callGeminiAnswer(params: { userPrompt: string; extraSystem?: string | null }): Promise<string> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error('GEMINI_API_KEY no configurada');

  const system = [DEFAULT_SYSTEM, params.extraSystem?.trim()].filter(Boolean).join('\n\n');
  const user = params.userPrompt;

  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: {
      temperature: 0.4,
      /** Gemini 2.5 puede usar parte del cupo en razonamiento interno; 1024 dejaba respuestas cortadas a mitad de frase. */
      maxOutputTokens: 4096
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
      const finish = cand?.finishReason;
      if (finish && finish !== 'STOP') {
        console.warn(`[ML Questions AI] Gemini finishReason=${finish} (respuesta puede estar incompleta)`);
      }
      const block = finish && finish !== 'STOP' ? ` (${finish})` : '';
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

async function callGroqAnswer(params: { userPrompt: string; extraSystem?: string | null }): Promise<string> {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) throw new Error('GROQ_API_KEY no configurada');

  const model = process.env.GROQ_MODEL?.trim() || 'llama-3.1-8b-instant';
  const system = [DEFAULT_SYSTEM, params.extraSystem?.trim()].filter(Boolean).join('\n\n');
  const user = params.userPrompt;

  const res = await axios.post(
    GROQ_URL,
    {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.4,
      max_tokens: 2048
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

async function callOpenAiAnswer(params: { userPrompt: string; extraSystem?: string | null }): Promise<string> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error('OPENAI_API_KEY no configurada en el servidor');

  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
  const system = [DEFAULT_SYSTEM, params.extraSystem?.trim()].filter(Boolean).join('\n\n');

  const user = params.userPrompt;

  const res = await axios.post(
    OPENAI_URL,
    {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.4,
      max_tokens: 2048
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

async function callOllamaAnswer(params: { userPrompt: string; extraSystem?: string | null }): Promise<string> {
  const model = process.env.OLLAMA_MODEL?.trim() || 'llama3.2';
  const system = [DEFAULT_SYSTEM, params.extraSystem?.trim()].filter(Boolean).join('\n\n');
  const url = `${ollamaBaseUrl()}/v1/chat/completions`;
  const timeoutMs = Math.min(
    300000,
    Math.max(30000, parseInt(process.env.OLLAMA_TIMEOUT_MS || '120000', 10) || 120000)
  );

  const res = await axios.post(
    url,
    {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: params.userPrompt }
      ],
      temperature: 0.4,
      stream: false
    },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: timeoutMs
    }
  );

  const text = res.data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Ollama no devolvió texto');
  return truncateAnswer(text);
}

async function generateLlmAnswer(params: {
  itemTitle: string;
  description: string;
  questionText: string;
  extraSystem?: string | null;
  catalogSummary: string;
  itemListingId: string;
  /** Texto derivado de GET /catalog/charts/{SIZE_GRID_ID} cuando la publicación tiene guía ML. */
  sizeGuideFromMl?: string;
}): Promise<string> {
  const provider = resolveProvider();
  if (!provider) {
    throw new Error(
      'Ningún proveedor de IA configurado. Opciones: GEMINI_API_KEY, GROQ_API_KEY, OPENAI_API_KEY, o Ollama local (LLM_PROVIDER=ollama).'
    );
  }
  const userPrompt = buildMlQuestionUserPrompt({
    catalogSummary: params.catalogSummary,
    itemListingId: params.itemListingId,
    itemTitle: params.itemTitle,
    description: params.description,
    sizeGuideFromMl: params.sizeGuideFromMl ?? '',
    questionText: params.questionText
  });
  const common = { userPrompt, extraSystem: params.extraSystem };
  if (provider === 'gemini') return callGeminiAnswer(common);
  if (provider === 'groq') return callGroqAnswer(common);
  if (provider === 'ollama') return callOllamaAnswer(common);
  return callOpenAiAnswer(common);
}

/** ML suele aceptar hasta ~2000 caracteres por respuesta; recortamos solo si el modelo se pasara. */
function truncateAnswer(s: string, max = 2000): string {
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
  const res = await mlGet(accessToken, `/items/${encodeURIComponent(itemId)}`, {
    include_attributes: 'all'
  });
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

/** Valor del atributo SIZE_GRID_ID en ítems ML (ID numérico de la tabla en /catalog/charts). */
function extractSizeGridIdFromItem(item: any): string | null {
  const pick = (attrs: any[] | undefined): string | null => {
    if (!Array.isArray(attrs)) return null;
    const a = attrs.find((x) => String(x?.id || '').toUpperCase() === 'SIZE_GRID_ID');
    if (!a) return null;
    const vid = a.value_id;
    if (vid != null && String(vid).trim() !== '') return String(vid).trim();
    if (Array.isArray(a.values) && a.values.length) {
      const first = a.values[0];
      if (first?.id != null && String(first.id).trim() !== '') return String(first.id).trim();
      const n = first?.name;
      if (n != null && /^\d+$/.test(String(n).trim())) return String(n).trim();
    }
    return null;
  };

  let id = pick(item?.attributes);
  if (id) return id;
  const vars = item?.variations;
  if (Array.isArray(vars)) {
    for (const v of vars) {
      id = pick(v?.attributes);
      if (id) return id;
    }
  }
  return null;
}

/** Convierte la respuesta de GET /catalog/charts/{id} en texto para el prompt. */
function formatMlSizeChartForPrompt(chart: any): string {
  if (!chart || typeof chart !== 'object') return '';
  const lines: string[] = [];
  const names = chart.names && typeof chart.names === 'object' ? chart.names : {};
  const nameStr = [names.MLA, names.MLB, names.MLC, names.MLU]
    .find((n: unknown) => typeof n === 'string' && n.trim())
    ?? Object.values(names).find((n: unknown) => typeof n === 'string' && String(n).trim());
  if (nameStr) lines.push(`Nombre de la guía: ${nameStr}`);
  if (chart.id != null) lines.push(`ID tabla ML: ${chart.id}`);

  const rows = Array.isArray(chart.rows) ? chart.rows : [];
  for (const row of rows) {
    const bits: string[] = [];
    const attrs = Array.isArray(row?.attributes) ? row.attributes : [];
    for (const att of attrs) {
      const label = (att.name || att.id || '').toString().trim();
      const vals = Array.isArray(att.values) ? att.values : [];
      const parts: string[] = [];
      for (const v of vals) {
        if (v?.name != null && String(v.name).trim()) parts.push(String(v.name).trim());
        else if (v?.struct && typeof v.struct.number === 'number') {
          const u = v.struct.unit ? ` ${v.struct.unit}` : '';
          parts.push(`${v.struct.number}${u}`);
        }
      }
      if (label && parts.length) bits.push(`${label}: ${parts.join(' / ')}`);
    }
    if (bits.length) lines.push(`- ${bits.join(' | ')}`);
  }

  let text = lines.join('\n').trim();
  if (text.length > ML_SIZE_CHART_MAX_CHARS) {
    text = text.slice(0, ML_SIZE_CHART_MAX_CHARS - 40) + '\n… (guía truncada por límite de contexto)';
  }
  return text;
}

async function fetchMlSizeChartForPrompt(accessToken: string, chartId: string): Promise<string> {
  const id = String(chartId || '').trim();
  if (!id) return '';
  try {
    /** /catalog/charts no usa el mismo contrato que /items; evitamos api_version en query. */
    const res = await axios.get(`${ML_API}/catalog/charts/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 45000
    });
    return formatMlSizeChartForPrompt(res.data);
  } catch (e: any) {
    const st = e?.response?.status;
    console.warn('[ML Questions AI] Guía de talles:', id, st || e?.message || e);
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
  | { questionId: string; status: 'suggested'; preview: string }
  | { questionId: string; status: 'error'; message: string };

type QuestionContext = {
  questionId: string;
  itemId: string;
  questionText: string;
  itemTitle: string;
  description: string;
  sizeGuideFromMl: string;
  catalogSummary: string;
};

async function loadQuestionContext(accessToken: string, questionId: string): Promise<QuestionContext | ProcessOneResult> {
  const q = await fetchQuestion(accessToken, questionId);
  if (!isQuestionUnanswered(q)) {
    return { questionId, status: 'skipped', reason: 'Ya respondida o cerrada' };
  }

  const itemId = String(q.item_id || '').trim();
  const questionText = String(q.text || '').trim();
  if (!questionText) {
    return { questionId, status: 'skipped', reason: 'Pregunta vacía' };
  }
  if (!itemId) {
    return { questionId, status: 'skipped', reason: 'Sin publicación asociada' };
  }

  const item = await fetchItem(accessToken, itemId);
  const title = String(item?.title || '(sin título)');
  const description = await fetchDescription(accessToken, itemId);
  const sizeGridId = extractSizeGridIdFromItem(item);
  const sizeGuideFromMl = sizeGridId ? await fetchMlSizeChartForPrompt(accessToken, sizeGridId) : '';
  const catalogSummary = await getCachedCatalogSummary();

  return {
    questionId,
    itemId,
    questionText,
    itemTitle: title,
    description,
    sizeGuideFromMl,
    catalogSummary
  };
}

async function generateAnswerFromContext(
  ctx: QuestionContext,
  extraSystemPrompt?: string | null
): Promise<string> {
  return generateLlmAnswer({
    itemTitle: ctx.itemTitle,
    description: ctx.description,
    questionText: ctx.questionText,
    extraSystem: extraSystemPrompt,
    catalogSummary: ctx.catalogSummary,
    itemListingId: ctx.itemId,
    sizeGuideFromMl: ctx.sizeGuideFromMl
  });
}

export async function publishAnswerToMl(
  accessToken: string,
  questionId: string,
  answerText: string,
  opts?: { sentSource?: 'review' | 'auto'; originalSuggestionText?: string | null }
): Promise<void> {
  const final = truncateAnswer(answerText);
  await mlPost(accessToken, '/answers', {
    question_id: Number(questionId),
    text: final
  });
  await recordSuggestionSent(questionId, {
    sentText: final,
    originalSuggestionText: opts?.originalSuggestionText,
    sentSource: opts?.sentSource ?? 'review'
  });
}

/** Genera sugerencia IA sin publicar en Mercado Libre. */
export async function suggestForQuestion(
  accessToken: string,
  questionId: string,
  opts?: { extraSystemPrompt?: string | null; forceRegenerate?: boolean }
): Promise<ProcessOneResult> {
  const loaded = await loadQuestionContext(accessToken, questionId);
  if ('status' in loaded) return loaded;
  const ctx = loaded;

  if (!opts?.forceRegenerate) {
    const existing = await getSuggestionByQuestionId(questionId);
    if (existing?.status === 'pending' && existing.suggestionText.trim()) {
      return { questionId, status: 'suggested', preview: existing.suggestionText.slice(0, 160) };
    }
  }

  const provider = resolveProvider();
  const answerText = await generateAnswerFromContext(ctx, opts?.extraSystemPrompt);
  await upsertSuggestion({
    questionId,
    itemId: ctx.itemId,
    questionText: ctx.questionText,
    suggestionText: answerText,
    status: 'pending',
    llmProvider: provider
  });

  return { questionId, status: 'suggested', preview: answerText.slice(0, 160) };
}

export async function approveAndSendSuggestion(
  accessToken: string,
  questionId: string,
  text?: string
): Promise<ProcessOneResult> {
  const loaded = await loadQuestionContext(accessToken, questionId);
  if ('status' in loaded) return loaded;

  let answerText = (text ?? '').trim();
  if (!answerText) {
    const existing = await getSuggestionByQuestionId(questionId);
    answerText = existing?.suggestionText?.trim() || '';
  }
  if (!answerText) {
    return { questionId, status: 'error', message: 'No hay texto de respuesta' };
  }

  const existing = await getSuggestionByQuestionId(questionId);
  await publishAnswerToMl(accessToken, questionId, answerText, {
    sentSource: 'review',
    originalSuggestionText: existing?.suggestionText ?? answerText
  });
  return { questionId, status: 'answered', preview: answerText.slice(0, 160) };
}

export async function processOneQuestion(
  accessToken: string,
  questionId: string,
  opts?: { extraSystemPrompt?: string | null; mode?: MlQuestionsAiMode }
): Promise<ProcessOneResult> {
  const mode = opts?.mode ?? 'auto';
  if (mode === 'off') {
    return { questionId, status: 'skipped', reason: 'IA desactivada' };
  }
  if (mode === 'suggest') {
    return suggestForQuestion(accessToken, questionId, { extraSystemPrompt: opts?.extraSystemPrompt });
  }

  const loaded = await loadQuestionContext(accessToken, questionId);
  if ('status' in loaded) return loaded;
  const ctx = loaded;

  const answerText = await generateAnswerFromContext(ctx, opts?.extraSystemPrompt);
  const provider = resolveProvider();
  await upsertSuggestion({
    questionId,
    itemId: ctx.itemId,
    questionText: ctx.questionText,
    suggestionText: answerText,
    status: 'pending',
    llmProvider: provider
  });
  await publishAnswerToMl(accessToken, questionId, answerText, {
    sentSource: 'auto',
    originalSuggestionText: answerText
  });

  return { questionId, status: 'answered', preview: answerText.slice(0, 160) };
}

export async function processUnansweredBatch(
  mlToken: MLToken,
  opts?: { limit?: number; extraSystemPrompt?: string | null; mode?: MlQuestionsAiMode }
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
        extraSystemPrompt: opts?.extraSystemPrompt,
        mode: opts?.mode
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

/** Si la configuración y el LLM están activos, procesa preguntas sin responder (webhook o cron). */
export async function runMlQuestionsAiIfEnabled(
  getToken: () => Promise<MLToken | null>,
  opts?: { limit?: number }
): Promise<{ ran: boolean; message?: string; processed?: number; results?: ProcessOneResult[] }> {
  const cfg = await getMlQuestionsAiConfigRow();
  if (cfg.mode === 'off') {
    return { ran: false, message: 'IA de preguntas desactivada' };
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
    extraSystemPrompt: cfg.extraSystemPrompt,
    mode: cfg.mode
  });
  return { ran: true, processed, results };
}
