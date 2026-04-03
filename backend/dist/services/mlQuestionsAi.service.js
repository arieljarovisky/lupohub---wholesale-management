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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureMlQuestionsAiConfigTable = ensureMlQuestionsAiConfigTable;
exports.getMlQuestionsAiConfigRow = getMlQuestionsAiConfigRow;
exports.saveMlQuestionsAiConfig = saveMlQuestionsAiConfig;
exports.openAiConfigured = openAiConfigured;
exports.llmConfigured = llmConfigured;
exports.getLlmStatus = getLlmStatus;
exports.buildLocalCatalogSummaryForMlQuestions = buildLocalCatalogSummaryForMlQuestions;
exports.fetchQuestion = fetchQuestion;
exports.searchUnansweredQuestions = searchUnansweredQuestions;
exports.processOneQuestion = processOneQuestion;
exports.processUnansweredBatch = processUnansweredBatch;
exports.runMlQuestionsAiIfEnabled = runMlQuestionsAiIfEnabled;
/**
 * Respuestas automáticas a preguntas de Mercado Libre con IA.
 * Proveedores soportados (configuración por .env):
 * - Google Gemini (GEMINI_API_KEY) — cuota gratuita en AI Studio
 * - Groq (GROQ_API_KEY) — tier gratuito, API compatible con OpenAI
 * - OpenAI (OPENAI_API_KEY) — de pago
 */
const axios_1 = __importDefault(require("axios"));
const db_1 = require("../database/db");
const ML_API = 'https://api.mercadolibre.com';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_SYSTEM = `Sos el asistente de un vendedor en Mercado Libre (Argentina).
Respondé en español rioplatense, de forma breve y cordial.
Reglas:
- Tenés dos fuentes: (1) el título y la descripción de LA publicación donde se hizo la pregunta, y (2) cuando se incluye el bloque "Catálogo LupoHub", es el inventario interno del negocio (SKU, talle, color, stock aproximado, vínculos ML si existen). Usá el catálogo para recomendar otras tallas, colores o artículos del mismo negocio cuando el comprador pida alternativas, más elasticidad, u otro modelo.
- Priorizá datos de la publicación actual para el producto puntual; usá el catálogo para comparar con el resto del stock y sugerir opciones reales.
- Si algo no figura ni en la descripción ni en el catálogo (envíos, garantías, plazos, políticas), no inventes: decí que no tenés ese dato y ofrecé canalizar por mensaje de compra o consulta en la publicación.
- No uses markdown ni emojis en exceso (como mucho uno).
- Máximo ~1200 caracteres. Sin listas largas.`;
function ensureMlQuestionsAiConfigTable() {
    return __awaiter(this, void 0, void 0, function* () {
        yield (0, db_1.execute)(`
    CREATE TABLE IF NOT EXISTS ml_questions_ai_config (
      id INT PRIMARY KEY DEFAULT 1,
      enabled BOOLEAN DEFAULT 0,
      extra_system_prompt TEXT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
    });
}
function getMlQuestionsAiConfigRow() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        yield ensureMlQuestionsAiConfigTable();
        const row = yield (0, db_1.get)(`SELECT enabled, extra_system_prompt AS extraSystemPrompt FROM ml_questions_ai_config WHERE id = 1`);
        if (!row) {
            yield (0, db_1.execute)(`INSERT INTO ml_questions_ai_config (id, enabled, extra_system_prompt) VALUES (1, 0, NULL)`);
            return { enabled: false, extraSystemPrompt: null };
        }
        return {
            enabled: row.enabled === 1 || row.enabled === true,
            extraSystemPrompt: (_a = row.extraSystemPrompt) !== null && _a !== void 0 ? _a : null
        };
    });
}
function saveMlQuestionsAiConfig(enabled, extraSystemPrompt) {
    return __awaiter(this, void 0, void 0, function* () {
        yield ensureMlQuestionsAiConfigTable();
        yield (0, db_1.execute)(`INSERT INTO ml_questions_ai_config (id, enabled, extra_system_prompt)
     VALUES (1, ?, ?)
     ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), extra_system_prompt = VALUES(extra_system_prompt)`, [enabled ? 1 : 0, (extraSystemPrompt === null || extraSystemPrompt === void 0 ? void 0 : extraSystemPrompt.trim()) || null]);
    });
}
function hasGeminiKey() {
    return !!(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
}
function hasGroqKey() {
    return !!(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim());
}
function hasOpenAiKey() {
    return !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim());
}
/** Orden por defecto: primero opciones con tier gratuito. */
function resolveProvider() {
    const explicit = (process.env.LLM_PROVIDER || process.env.AI_PROVIDER || '').trim().toLowerCase();
    if (explicit === 'gemini' && hasGeminiKey())
        return 'gemini';
    if (explicit === 'groq' && hasGroqKey())
        return 'groq';
    if (explicit === 'openai' && hasOpenAiKey())
        return 'openai';
    if (explicit)
        return null;
    if (hasGeminiKey())
        return 'gemini';
    if (hasGroqKey())
        return 'groq';
    if (hasOpenAiKey())
        return 'openai';
    return null;
}
/** Compatibilidad: “hay algún LLM configurado”. */
function openAiConfigured() {
    return resolveProvider() !== null;
}
function llmConfigured() {
    return resolveProvider() !== null;
}
function getLlmStatus() {
    const provider = resolveProvider();
    const labels = {
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
const GEMINI_FALLBACK_MODELS = ['gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-flash-latest'];
function isGeminiModelNotFound(err) {
    var _a, _b, _c;
    if (!axios_1.default.isAxiosError(err))
        return false;
    if (((_a = err.response) === null || _a === void 0 ? void 0 : _a.status) === 404)
        return true;
    const e = (_b = err.response) === null || _b === void 0 ? void 0 : _b.data;
    return ((_c = e === null || e === void 0 ? void 0 : e.error) === null || _c === void 0 ? void 0 : _c.status) === 'NOT_FOUND';
}
function geminiModelAttempts() {
    var _a;
    const fromEnv = (_a = process.env.GEMINI_MODEL) === null || _a === void 0 ? void 0 : _a.trim();
    const primary = fromEnv || DEFAULT_GEMINI_MODEL;
    const rest = GEMINI_FALLBACK_MODELS.filter((m) => m !== primary);
    return [primary, ...rest];
}
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
let catalogCache = null;
function catalogEnabled() {
    const v = (process.env.ML_QUESTIONS_AI_CATALOG_ENABLED || 'true').trim().toLowerCase();
    return v !== '0' && v !== 'false' && v !== 'no';
}
function maxCatalogRows() {
    const n = parseInt(process.env.ML_QUESTIONS_AI_CATALOG_MAX_ROWS || '600', 10);
    return Math.min(5000, Math.max(50, Number.isFinite(n) ? n : 600));
}
function maxCatalogChars() {
    const n = parseInt(process.env.ML_QUESTIONS_AI_CATALOG_MAX_CHARS || '14000', 10);
    return Math.min(100000, Math.max(2000, Number.isFinite(n) ? n : 14000));
}
/** Resumen de variantes en LupoHub para contexto de IA (preguntas ML). */
function buildLocalCatalogSummaryForMlQuestions() {
    return __awaiter(this, void 0, void 0, function* () {
        if (!catalogEnabled())
            return '';
        try {
            const limit = maxCatalogRows();
            const rows = yield (0, db_1.query)(`SELECT
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
       LIMIT ?`, [limit]);
            if (!(rows === null || rows === void 0 ? void 0 : rows.length)) {
                return '(No hay variantes cargadas en LupoHub.)';
            }
            const lines = [];
            for (const r of rows) {
                const sku = (r.variant_sku || r.base_sku || '—').toString().trim();
                const talle = [r.size_code, r.size_name].filter(Boolean).join(' ').trim() || '—';
                const color = (r.color_name || '—').toString();
                const ml = (r.ml_variant_item || r.ml_product || '').toString().trim();
                const mlBit = ml ? ` | ML:${ml}` : '';
                lines.push(`- ${sku} | ${String(r.product_name || '').trim()} | Cat:${r.category || '—'} | Talle:${talle} | Color:${color} | Stock:${Number(r.stock) || 0}${mlBit}`);
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
        }
        catch (e) {
            console.warn('[ML Questions AI] Catálogo local:', (e === null || e === void 0 ? void 0 : e.message) || e);
            return '(No se pudo cargar el catálogo LupoHub.)';
        }
    });
}
function getCachedCatalogSummary() {
    return __awaiter(this, void 0, void 0, function* () {
        if (!catalogEnabled())
            return '';
        const now = Date.now();
        if (catalogCache && now - catalogCache.at < CATALOG_CACHE_TTL_MS) {
            return catalogCache.text;
        }
        const text = yield buildLocalCatalogSummaryForMlQuestions();
        catalogCache = { text, at: now };
        return text;
    });
}
function buildMlQuestionUserPrompt(params) {
    var _a;
    const cat = (_a = params.catalogSummary) === null || _a === void 0 ? void 0 : _a.trim();
    const catBlock = cat
        ? `Catálogo LupoHub (inventario interno; puede estar incompleto o truncado):\n${cat}\n\n---\n\n`
        : '';
    return (`${catBlock}` +
        `Publicación de Mercado Libre donde está la pregunta (ID ítem: ${params.itemListingId}):\n` +
        `Título: ${params.itemTitle}\n\n` +
        `Descripción (texto plano):\n${params.description || '(sin descripción)'}\n\n` +
        `Pregunta del comprador:\n${params.questionText}`);
}
function callGeminiAnswer(params) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g;
        const key = (_a = process.env.GEMINI_API_KEY) === null || _a === void 0 ? void 0 : _a.trim();
        if (!key)
            throw new Error('GEMINI_API_KEY no configurada');
        const system = [DEFAULT_SYSTEM, (_b = params.extraSystem) === null || _b === void 0 ? void 0 : _b.trim()].filter(Boolean).join('\n\n');
        const user = params.userPrompt;
        const body = {
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: user }] }],
            generationConfig: {
                temperature: 0.4,
                maxOutputTokens: 1024
            }
        };
        let lastErr;
        for (const model of geminiModelAttempts()) {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
            try {
                const res = yield axios_1.default.post(url, body, {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 60000
                });
                const cand = (_d = (_c = res.data) === null || _c === void 0 ? void 0 : _c.candidates) === null || _d === void 0 ? void 0 : _d[0];
                const block = (cand === null || cand === void 0 ? void 0 : cand.finishReason) && cand.finishReason !== 'STOP' ? ` (${cand.finishReason})` : '';
                const text = ((_g = (_f = (_e = cand === null || cand === void 0 ? void 0 : cand.content) === null || _e === void 0 ? void 0 : _e.parts) === null || _f === void 0 ? void 0 : _f.map((p) => p.text || '').join('')) === null || _g === void 0 ? void 0 : _g.trim()) || '';
                if (!text)
                    throw new Error(`Gemini no devolvió texto${block}`);
                return truncateAnswer(text);
            }
            catch (err) {
                lastErr = err;
                if (isGeminiModelNotFound(err)) {
                    console.warn(`[ML Questions AI] Modelo Gemini no disponible (${model}), probando siguiente…`);
                    continue;
                }
                throw err;
            }
        }
        throw lastErr instanceof Error ? lastErr : new Error('Gemini: sin modelo disponible');
    });
}
function callGroqAnswer(params) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const key = (_a = process.env.GROQ_API_KEY) === null || _a === void 0 ? void 0 : _a.trim();
        if (!key)
            throw new Error('GROQ_API_KEY no configurada');
        const model = ((_b = process.env.GROQ_MODEL) === null || _b === void 0 ? void 0 : _b.trim()) || 'llama-3.1-8b-instant';
        const system = [DEFAULT_SYSTEM, (_c = params.extraSystem) === null || _c === void 0 ? void 0 : _c.trim()].filter(Boolean).join('\n\n');
        const user = params.userPrompt;
        const res = yield axios_1.default.post(GROQ_URL, {
            model,
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: user }
            ],
            temperature: 0.4,
            max_tokens: 700
        }, {
            headers: {
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json'
            },
            timeout: 60000
        });
        const text = (_h = (_g = (_f = (_e = (_d = res.data) === null || _d === void 0 ? void 0 : _d.choices) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.message) === null || _g === void 0 ? void 0 : _g.content) === null || _h === void 0 ? void 0 : _h.trim();
        if (!text)
            throw new Error('Groq no devolvió texto');
        return truncateAnswer(text);
    });
}
function callOpenAiAnswer(params) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const key = (_a = process.env.OPENAI_API_KEY) === null || _a === void 0 ? void 0 : _a.trim();
        if (!key)
            throw new Error('OPENAI_API_KEY no configurada en el servidor');
        const model = ((_b = process.env.OPENAI_MODEL) === null || _b === void 0 ? void 0 : _b.trim()) || 'gpt-4o-mini';
        const system = [DEFAULT_SYSTEM, (_c = params.extraSystem) === null || _c === void 0 ? void 0 : _c.trim()].filter(Boolean).join('\n\n');
        const user = params.userPrompt;
        const res = yield axios_1.default.post(OPENAI_URL, {
            model,
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: user }
            ],
            temperature: 0.4,
            max_tokens: 700
        }, {
            headers: {
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json'
            },
            timeout: 60000
        });
        const text = (_h = (_g = (_f = (_e = (_d = res.data) === null || _d === void 0 ? void 0 : _d.choices) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.message) === null || _g === void 0 ? void 0 : _g.content) === null || _h === void 0 ? void 0 : _h.trim();
        if (!text)
            throw new Error('OpenAI no devolvió texto');
        return truncateAnswer(text);
    });
}
function generateLlmAnswer(params) {
    return __awaiter(this, void 0, void 0, function* () {
        const provider = resolveProvider();
        if (!provider) {
            throw new Error('Ningún proveedor de IA configurado. Agregá GEMINI_API_KEY (recomendado, gratis), GROQ_API_KEY (gratis) u OPENAI_API_KEY en el servidor.');
        }
        const userPrompt = buildMlQuestionUserPrompt({
            catalogSummary: params.catalogSummary,
            itemListingId: params.itemListingId,
            itemTitle: params.itemTitle,
            description: params.description,
            questionText: params.questionText
        });
        const common = { userPrompt, extraSystem: params.extraSystem };
        if (provider === 'gemini')
            return callGeminiAnswer(common);
        if (provider === 'groq')
            return callGroqAnswer(common);
        return callOpenAiAnswer(common);
    });
}
function truncateAnswer(s, max = 1900) {
    const t = s.trim();
    if (t.length <= max)
        return t;
    return t.slice(0, max - 3) + '...';
}
function mlGet(accessToken, path, query) {
    return __awaiter(this, void 0, void 0, function* () {
        return axios_1.default.get(`${ML_API}${path}`, {
            params: Object.assign({ api_version: 4 }, query),
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: 45000
        });
    });
}
function mlPost(accessToken, path, body) {
    return __awaiter(this, void 0, void 0, function* () {
        return axios_1.default.post(`${ML_API}${path}`, body, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            timeout: 45000
        });
    });
}
/** Obtiene una pregunta por ID. */
function fetchQuestion(accessToken, questionId) {
    return __awaiter(this, void 0, void 0, function* () {
        const res = yield mlGet(accessToken, `/questions/${questionId}`);
        return res.data;
    });
}
/** Lista preguntas sin responder del vendedor. */
function searchUnansweredQuestions(accessToken_1, sellerId_1) {
    return __awaiter(this, arguments, void 0, function* (accessToken, sellerId, limit = 20) {
        const res = yield mlGet(accessToken, `/questions/search`, {
            seller_id: sellerId,
            status: 'UNANSWERED',
            limit: Math.min(Math.max(limit, 1), 50)
        });
        return res.data;
    });
}
function fetchItem(accessToken, itemId) {
    return __awaiter(this, void 0, void 0, function* () {
        const res = yield mlGet(accessToken, `/items/${encodeURIComponent(itemId)}`);
        return res.data;
    });
}
function fetchDescription(accessToken, itemId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        try {
            const res = yield mlGet(accessToken, `/items/${encodeURIComponent(itemId)}/description`);
            const plain = (_d = (_b = (_a = res.data) === null || _a === void 0 ? void 0 : _a.plain_text) !== null && _b !== void 0 ? _b : (_c = res.data) === null || _c === void 0 ? void 0 : _c.text) !== null && _d !== void 0 ? _d : '';
            return typeof plain === 'string' ? plain : '';
        }
        catch (_e) {
            return '';
        }
    });
}
function isQuestionUnanswered(q) {
    var _a;
    const st = String((q === null || q === void 0 ? void 0 : q.status) || '').toUpperCase();
    if (st === 'ANSWERED')
        return false;
    if ((q === null || q === void 0 ? void 0 : q.answer) && String(((_a = q.answer) === null || _a === void 0 ? void 0 : _a.status) || '').toUpperCase() === 'ACTIVE')
        return false;
    return true;
}
function processOneQuestion(accessToken, questionId, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        const q = yield fetchQuestion(accessToken, questionId);
        if (!isQuestionUnanswered(q)) {
            return { questionId, status: 'skipped', reason: 'Ya respondida o cerrada' };
        }
        const itemId = q.item_id;
        const questionText = String(q.text || '').trim();
        if (!questionText) {
            return { questionId, status: 'skipped', reason: 'Pregunta vacía' };
        }
        const item = yield fetchItem(accessToken, itemId);
        const title = String((item === null || item === void 0 ? void 0 : item.title) || '(sin título)');
        const description = yield fetchDescription(accessToken, itemId);
        const catalogSummary = yield getCachedCatalogSummary();
        const answerText = yield generateLlmAnswer({
            itemTitle: title,
            description,
            questionText,
            extraSystem: opts === null || opts === void 0 ? void 0 : opts.extraSystemPrompt,
            catalogSummary,
            itemListingId: String(itemId)
        });
        yield mlPost(accessToken, '/answers', {
            question_id: Number(questionId),
            text: answerText
        });
        return { questionId, status: 'answered', preview: answerText.slice(0, 160) };
    });
}
function processUnansweredBatch(mlToken, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f;
        const limit = Math.min(Math.max((_a = opts === null || opts === void 0 ? void 0 : opts.limit) !== null && _a !== void 0 ? _a : 10, 1), 25);
        const search = yield searchUnansweredQuestions(mlToken.access_token, mlToken.user_id, limit);
        const questions = search.questions || [];
        const results = [];
        for (const q of questions.slice(0, limit)) {
            const id = String((_b = q === null || q === void 0 ? void 0 : q.id) !== null && _b !== void 0 ? _b : '');
            if (!id)
                continue;
            try {
                const r = yield processOneQuestion(mlToken.access_token, id, {
                    extraSystemPrompt: opts === null || opts === void 0 ? void 0 : opts.extraSystemPrompt
                });
                results.push(r);
                yield new Promise((r) => setTimeout(r, 400));
            }
            catch (e) {
                const msg = ((_d = (_c = e === null || e === void 0 ? void 0 : e.response) === null || _c === void 0 ? void 0 : _c.data) === null || _d === void 0 ? void 0 : _d.message) || ((_f = (_e = e === null || e === void 0 ? void 0 : e.response) === null || _e === void 0 ? void 0 : _e.data) === null || _f === void 0 ? void 0 : _f.error) || (e === null || e === void 0 ? void 0 : e.message) || String(e);
                results.push({ questionId: id, status: 'error', message: String(msg) });
            }
        }
        return { processed: results.length, results };
    });
}
/** Si la configuración y OpenAI están activos, procesa preguntas sin responder (para webhook o cron). */
function runMlQuestionsAiIfEnabled(getToken, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const cfg = yield getMlQuestionsAiConfigRow();
        if (!cfg.enabled) {
            return { ran: false, message: 'Auto-respuesta desactivada' };
        }
        if (!llmConfigured()) {
            return { ran: false, message: 'Ninguna clave de IA configurada (GEMINI_API_KEY, GROQ_API_KEY u OPENAI_API_KEY)' };
        }
        const token = yield getToken();
        if (!token) {
            return { ran: false, message: 'Sin token de Mercado Libre' };
        }
        const { processed, results } = yield processUnansweredBatch(token, {
            limit: (_a = opts === null || opts === void 0 ? void 0 : opts.limit) !== null && _a !== void 0 ? _a : 5,
            extraSystemPrompt: cfg.extraSystemPrompt
        });
        return { ran: true, processed, results };
    });
}
