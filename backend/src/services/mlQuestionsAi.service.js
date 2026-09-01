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
exports.ensureMlQuestionsAiSuggestionsTable = ensureMlQuestionsAiSuggestionsTable;
exports.getMlQuestionsAiConfigRow = getMlQuestionsAiConfigRow;
exports.saveMlQuestionsAiConfig = saveMlQuestionsAiConfig;
exports.getSuggestionByQuestionId = getSuggestionByQuestionId;
exports.getSuggestionsByQuestionIds = getSuggestionsByQuestionIds;
exports.rejectSuggestion = rejectSuggestion;
exports.getMlQuestionsAiMetrics = getMlQuestionsAiMetrics;
exports.openAiConfigured = openAiConfigured;
exports.llmConfigured = llmConfigured;
exports.getLlmStatus = getLlmStatus;
exports.buildLocalCatalogSummaryForMlQuestions = buildLocalCatalogSummaryForMlQuestions;
exports.fetchQuestion = fetchQuestion;
exports.searchUnansweredQuestions = searchUnansweredQuestions;
exports.publishAnswerToMl = publishAnswerToMl;
exports.suggestForQuestion = suggestForQuestion;
exports.approveAndSendSuggestion = approveAndSendSuggestion;
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
const lupoSizeGuide_1 = require("../data/lupoSizeGuide");
const db_1 = require("../database/db");
const ML_API = 'https://api.mercadolibre.com';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_SYSTEM = `Sos el asistente de un vendedor en Mercado Libre (Argentina).
Respondé en español rioplatense, de forma breve y cordial.
Reglas:
- Fuentes de la publicación: (1) El bloque "Guía oficial de talles Lupo" es la tabla de la marca: usala SIEMPRE como base para recomendar qué talle pedir (P/M/G/GG/XG/XXG) según las medidas del comprador. Elegí la tabla según el tipo de prenda (boxer, slip, faja, corpiño/top, bombacha, media). (2) Si aparece "Guía de talles (Mercado Libre)", es la tabla de ESA publicación: usala como complemento si hay datos específicos del modelo. Si contradice la guía Lupo, priorizá la guía Lupo salvo que la de ML sea claramente más específica para ese artículo (p. ej. modelo plus). (3) Título y descripción (texto de la ficha). (4) El bloque "Catálogo LupoHub" es inventario interno (SKU, talle, color, stock, vínculos ML). Usá el catálogo para alternativas de modelo/color/stock cuando el comprador pida opciones.
- Preguntas de talle/medidas (qué talle pedir, M vs G, cm de cintura/cadera/busto, número de calzado, etc.): basate en la Guía oficial de talles Lupo. Relacioná las medidas del comprador con la fila correcta. Si queda entre dos talles, recomendá el mayor. En fajas no bajes de talle para más compresión. En bombachas priorizá la cadera. En medias usá el número de calzado. No te cortes a mitad de frase: si recomendás un talle, decí cuál y en una oración por qué. Si falta un dato imprescindible, pedilo (cintura, cadera, busto o calzado según la prenda) o compará opciones sin dejar la respuesta inconclusa.
- Si el comprador pregunta por "más grande", "más chico", "más elástico", "otro talle", "otro modelo" o similares, revisá el catálogo y:
  1) confirmá si existe alguna alternativa real,
  2) mencioná hasta 3 opciones concretas (nombre/SKU/talle/color) que sí estén en catálogo,
  3) si no hay alternativas, decilo claramente.
- Cuando afirmes que "sí hay", apoyate en datos visibles del catálogo. No inventes productos ni talles.
- Si un detalle del producto (material, si enrolla/estira, composición, cuidados, etc.) NO figura en la guía de talles, la descripción ni el catálogo, BUSCÁ en internet por marca, modelo y nombre del artículo antes de responder. Usá resultados confiables (fabricante, tiendas oficiales, fichas técnicas). Solo si después de buscar no hay dato creíble, decilo con honestidad y ofrecé consultar por mensaje post-compra.
- Para envíos, garantías, plazos de retiro o políticas del vendedor que no estén en la ficha, no inventes: decí que no tenés ese dato operativo y ofrecé canalizar por mensaje de compra.
- No uses markdown ni emojis en exceso (como mucho uno).
- Máximo ~1200 caracteres. Sin listas largas. Siempre cerrá oraciones: la respuesta debe ser un texto completo y útil, nunca truncada a mitad de idea.`;
function ensureMlQuestionsAiConfigTable() {
    return __awaiter(this, void 0, void 0, function* () {
        yield (0, db_1.execute)(`
    CREATE TABLE IF NOT EXISTS ml_questions_ai_config (
      id INT PRIMARY KEY DEFAULT 1,
      enabled BOOLEAN DEFAULT 0,
      mode VARCHAR(16) DEFAULT 'off',
      extra_system_prompt TEXT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
        try {
            yield (0, db_1.execute)(`ALTER TABLE ml_questions_ai_config ADD COLUMN mode VARCHAR(16) DEFAULT 'off'`);
        }
        catch (_a) {
            /* columna ya existe */
        }
    });
}
function ensureMlQuestionsAiSuggestionsTable() {
    return __awaiter(this, void 0, void 0, function* () {
        yield (0, db_1.execute)(`
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
                yield (0, db_1.execute)(`ALTER TABLE ml_questions_ai_suggestions ADD COLUMN ${col}`);
            }
            catch (_a) {
                /* columna ya existe */
            }
        }
    });
}
function normalizeMode(raw, enabledFallback) {
    const s = String(raw || '').trim().toLowerCase();
    if (s === 'suggest' || s === 'auto' || s === 'off')
        return s;
    if (enabledFallback === true)
        return 'auto';
    return 'off';
}
function getMlQuestionsAiConfigRow() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        yield ensureMlQuestionsAiConfigTable();
        const row = yield (0, db_1.get)(`SELECT enabled, mode, extra_system_prompt AS extraSystemPrompt FROM ml_questions_ai_config WHERE id = 1`);
        if (!row) {
            yield (0, db_1.execute)(`INSERT INTO ml_questions_ai_config (id, enabled, mode, extra_system_prompt) VALUES (1, 0, 'off', NULL)`);
            return { enabled: false, mode: 'off', extraSystemPrompt: null };
        }
        const enabled = row.enabled === 1 || row.enabled === true;
        const mode = normalizeMode(row.mode, enabled);
        return {
            enabled: mode !== 'off',
            mode,
            extraSystemPrompt: (_a = row.extraSystemPrompt) !== null && _a !== void 0 ? _a : null
        };
    });
}
function saveMlQuestionsAiConfig(params) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        yield ensureMlQuestionsAiConfigTable();
        const current = yield getMlQuestionsAiConfigRow();
        let mode = (_a = params.mode) !== null && _a !== void 0 ? _a : current.mode;
        if (params.enabled != null && params.mode == null) {
            mode = params.enabled ? (current.mode === 'off' ? 'auto' : current.mode) : 'off';
        }
        if (mode !== 'off' && mode !== 'suggest' && mode !== 'auto')
            mode = 'off';
        const enabled = mode !== 'off';
        const extra = params.extraSystemPrompt !== undefined ? ((_b = params.extraSystemPrompt) === null || _b === void 0 ? void 0 : _b.trim()) || null : current.extraSystemPrompt;
        yield (0, db_1.execute)(`INSERT INTO ml_questions_ai_config (id, enabled, mode, extra_system_prompt)
     VALUES (1, ?, ?, ?)
     ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), mode = VALUES(mode), extra_system_prompt = VALUES(extra_system_prompt)`, [enabled ? 1 : 0, mode, extra]);
    });
}
function mapSuggestionRow(row) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    return {
        questionId: String((_a = row.questionId) !== null && _a !== void 0 ? _a : row.question_id),
        itemId: (_c = (_b = row.itemId) !== null && _b !== void 0 ? _b : row.item_id) !== null && _c !== void 0 ? _c : null,
        questionText: (_e = (_d = row.questionText) !== null && _d !== void 0 ? _d : row.question_text) !== null && _e !== void 0 ? _e : null,
        suggestionText: String((_g = (_f = row.suggestionText) !== null && _f !== void 0 ? _f : row.suggestion_text) !== null && _g !== void 0 ? _g : ''),
        status: (row.status || 'pending'),
        llmProvider: (_j = (_h = row.llmProvider) !== null && _h !== void 0 ? _h : row.llm_provider) !== null && _j !== void 0 ? _j : null,
        createdAt: (_l = (_k = row.createdAt) !== null && _k !== void 0 ? _k : row.created_at) !== null && _l !== void 0 ? _l : null,
        updatedAt: (_o = (_m = row.updatedAt) !== null && _m !== void 0 ? _m : row.updated_at) !== null && _o !== void 0 ? _o : null
    };
}
function getSuggestionByQuestionId(questionId) {
    return __awaiter(this, void 0, void 0, function* () {
        yield ensureMlQuestionsAiSuggestionsTable();
        const row = yield (0, db_1.get)(`SELECT question_id AS questionId, item_id AS itemId, question_text AS questionText,
            suggestion_text AS suggestionText, status, llm_provider AS llmProvider,
            created_at AS createdAt, updated_at AS updatedAt
     FROM ml_questions_ai_suggestions WHERE question_id = ?`, [questionId]);
        return row ? mapSuggestionRow(row) : null;
    });
}
function getSuggestionsByQuestionIds(ids) {
    return __awaiter(this, void 0, void 0, function* () {
        yield ensureMlQuestionsAiSuggestionsTable();
        const map = new Map();
        const clean = [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))];
        if (!clean.length)
            return map;
        const placeholders = clean.map(() => '?').join(',');
        const rows = yield (0, db_1.query)(`SELECT question_id AS questionId, item_id AS itemId, question_text AS questionText,
            suggestion_text AS suggestionText, status, llm_provider AS llmProvider,
            created_at AS createdAt, updated_at AS updatedAt
     FROM ml_questions_ai_suggestions WHERE question_id IN (${placeholders})`, clean);
        for (const row of rows) {
            const s = mapSuggestionRow(row);
            map.set(s.questionId, s);
        }
        return map;
    });
}
function upsertSuggestion(params) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        yield ensureMlQuestionsAiSuggestionsTable();
        yield (0, db_1.execute)(`INSERT INTO ml_questions_ai_suggestions
       (question_id, item_id, question_text, suggestion_text, status, llm_provider)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       item_id = VALUES(item_id),
       question_text = VALUES(question_text),
       suggestion_text = VALUES(suggestion_text),
       status = VALUES(status),
       llm_provider = VALUES(llm_provider)`, [
            params.questionId,
            (_a = params.itemId) !== null && _a !== void 0 ? _a : null,
            (_b = params.questionText) !== null && _b !== void 0 ? _b : null,
            params.suggestionText,
            (_c = params.status) !== null && _c !== void 0 ? _c : 'pending',
            (_d = params.llmProvider) !== null && _d !== void 0 ? _d : null
        ]);
    });
}
function rejectSuggestion(questionId) {
    return __awaiter(this, void 0, void 0, function* () {
        yield ensureMlQuestionsAiSuggestionsTable();
        yield (0, db_1.execute)(`UPDATE ml_questions_ai_suggestions SET status = 'rejected' WHERE question_id = ?`, [questionId]);
    });
}
function normalizeTextForCompare(s) {
    return s.trim().replace(/\s+/g, ' ');
}
function recordSuggestionSent(questionId, params) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        yield ensureMlQuestionsAiSuggestionsTable();
        let wasEdited = null;
        if (params.sentSource === 'review' && params.originalSuggestionText != null) {
            wasEdited =
                normalizeTextForCompare(params.originalSuggestionText) === normalizeTextForCompare(params.sentText) ? 0 : 1;
        }
        const existing = yield (0, db_1.get)(`SELECT question_id FROM ml_questions_ai_suggestions WHERE question_id = ?`, [questionId]);
        if (!existing) {
            yield (0, db_1.execute)(`INSERT INTO ml_questions_ai_suggestions
         (question_id, suggestion_text, status, sent_text, was_edited, sent_source, sent_at)
       VALUES (?, ?, 'sent', ?, ?, ?, NOW())`, [
                questionId,
                (_a = params.originalSuggestionText) !== null && _a !== void 0 ? _a : params.sentText,
                params.sentText,
                wasEdited,
                params.sentSource
            ]);
            return;
        }
        yield (0, db_1.execute)(`UPDATE ml_questions_ai_suggestions
     SET status = 'sent', sent_text = ?, was_edited = ?, sent_source = ?, sent_at = NOW()
     WHERE question_id = ?`, [params.sentText, wasEdited, params.sentSource, questionId]);
    });
}
function metricsReadyThresholds() {
    const minSends = Math.max(5, parseInt(process.env.ML_QUESTIONS_AI_AUTO_READY_MIN_SENDS || '15', 10) || 15);
    const ratePct = parseFloat(process.env.ML_QUESTIONS_AI_AUTO_READY_RATE || '85') || 85;
    const rate = Math.min(100, Math.max(50, ratePct)) / 100;
    return { minSends, rate };
}
function getMlQuestionsAiMetrics() {
    return __awaiter(this, void 0, void 0, function* () {
        yield ensureMlQuestionsAiSuggestionsTable();
        const row = yield (0, db_1.get)(`
    SELECT
      COUNT(*) AS totalGenerated,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'sent' AND sent_source = 'review' AND was_edited = 0 THEN 1 ELSE 0 END) AS sentUnchanged,
      SUM(CASE WHEN status = 'sent' AND sent_source = 'review' AND was_edited = 1 THEN 1 ELSE 0 END) AS sentEdited,
      SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
      SUM(CASE WHEN status = 'sent' AND sent_source = 'auto' THEN 1 ELSE 0 END) AS autoSent
    FROM ml_questions_ai_suggestions
  `);
        const totalGenerated = Number(row === null || row === void 0 ? void 0 : row.totalGenerated) || 0;
        const pending = Number(row === null || row === void 0 ? void 0 : row.pending) || 0;
        const sentUnchanged = Number(row === null || row === void 0 ? void 0 : row.sentUnchanged) || 0;
        const sentEdited = Number(row === null || row === void 0 ? void 0 : row.sentEdited) || 0;
        const rejected = Number(row === null || row === void 0 ? void 0 : row.rejected) || 0;
        const autoSent = Number(row === null || row === void 0 ? void 0 : row.autoSent) || 0;
        const reviewSentTotal = sentUnchanged + sentEdited;
        const unchangedRate = reviewSentTotal > 0 ? Math.round((sentUnchanged / reviewSentTotal) * 1000) / 10 : null;
        const { minSends, rate } = metricsReadyThresholds();
        const readyForAuto = reviewSentTotal >= minSends && unchangedRate != null && unchangedRate / 100 >= rate;
        let recommendation;
        if (reviewSentTotal === 0) {
            recommendation =
                'Todavía no hay respuestas enviadas tras revisión. Usá modo sugerencias y aprobá algunas preguntas para medir la calidad.';
        }
        else if (reviewSentTotal < minSends) {
            recommendation = `Llevás ${reviewSentTotal} envío(s) revisado(s). Con ${minSends} o más podremos recomendar el modo automático.`;
        }
        else if (readyForAuto) {
            recommendation = `El ${unchangedRate}% se envió sin editar. Buen momento para probar respuesta automática.`;
        }
        else if (unchangedRate != null && unchangedRate >= 70) {
            recommendation = `El ${unchangedRate}% se envió sin editar. Cerca del objetivo (${Math.round(rate * 100)}%). Revisá las que editaste y ajustá el prompt si hace falta.`;
        }
        else {
            recommendation = `Solo el ${unchangedRate !== null && unchangedRate !== void 0 ? unchangedRate : 0}% se envió sin editar. Seguí en modo sugerencias y refiná las instrucciones extra de la IA.`;
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
function ollamaBaseUrl() {
    const raw = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').trim();
    return raw.replace(/\/$/, '');
}
function hasOllama() {
    const explicit = (process.env.LLM_PROVIDER || process.env.AI_PROVIDER || '').trim().toLowerCase() === 'ollama';
    if (explicit)
        return true;
    return !!(process.env.OLLAMA_BASE_URL && process.env.OLLAMA_BASE_URL.trim());
}
/** Orden por defecto: primero opciones con tier gratuito en la nube; Ollama si es el único configurado. */
function resolveProvider() {
    const explicit = (process.env.LLM_PROVIDER || process.env.AI_PROVIDER || '').trim().toLowerCase();
    if (explicit === 'ollama' && hasOllama())
        return 'ollama';
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
    if (hasOllama())
        return 'ollama';
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
    var _a;
    const provider = resolveProvider();
    const labels = {
        gemini: 'Google Gemini (gratis en AI Studio)',
        groq: 'Groq (gratis)',
        openai: 'OpenAI (de pago)',
        ollama: `Ollama local (${((_a = process.env.OLLAMA_MODEL) === null || _a === void 0 ? void 0 : _a.trim()) || 'llama3.2'})`
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
const ML_SIZE_CHART_MAX_CHARS = 14000;
function webSearchEnabled() {
    const v = (process.env.ML_QUESTIONS_AI_WEB_SEARCH || 'true').trim().toLowerCase();
    return v !== '0' && v !== 'false' && v !== 'no';
}
/** Atributos ML útiles para buscar el producto en internet (marca, modelo, etc.). */
function extractItemSearchHints(item) {
    const lines = [];
    const attrs = Array.isArray(item === null || item === void 0 ? void 0 : item.attributes) ? item.attributes : [];
    const pick = (ids) => {
        var _a, _b;
        for (const id of ids) {
            const a = attrs.find((x) => String((x === null || x === void 0 ? void 0 : x.id) || '').toUpperCase() === id.toUpperCase());
            if (!a)
                continue;
            const name = (_a = a.value_name) !== null && _a !== void 0 ? _a : a.value_id;
            if (name != null && String(name).trim())
                return String(name).trim();
            if (Array.isArray(a.values) && ((_b = a.values[0]) === null || _b === void 0 ? void 0 : _b.name))
                return String(a.values[0].name).trim();
        }
        return null;
    };
    const brand = pick(['BRAND', 'MARCA']);
    const model = pick(['MODEL', 'MODELO']);
    const line = pick(['LINE', 'LINEA']);
    const gender = pick(['GENDER', 'GÉNERO', 'GENERO']);
    const material = pick(['MATERIAL', 'MAIN_MATERIAL', 'FABRIC']);
    if (brand)
        lines.push(`Marca: ${brand}`);
    if (model)
        lines.push(`Modelo: ${model}`);
    if (line)
        lines.push(`Línea: ${line}`);
    if (gender)
        lines.push(`Género: ${gender}`);
    if (material)
        lines.push(`Material: ${material}`);
    if (item === null || item === void 0 ? void 0 : item.category_id)
        lines.push(`Categoría ML: ${item.category_id}`);
    return lines.length ? lines.join('\n') : '';
}
function buildMlQuestionUserPrompt(params) {
    var _a, _b, _c;
    const cat = (_a = params.catalogSummary) === null || _a === void 0 ? void 0 : _a.trim();
    const catBlock = cat
        ? `Catálogo LupoHub (inventario interno; puede estar incompleto o truncado):\n${cat}\n\n---\n\n`
        : '';
    const lupoGuideBlock = `Guía oficial de talles Lupo (base para recomendar qué talle pedir):\n${lupoSizeGuide_1.LUPO_SIZE_GUIDE_TEXT}\n\n---\n\n`;
    const guide = (_b = params.sizeGuideFromMl) === null || _b === void 0 ? void 0 : _b.trim();
    const guideBlock = guide
        ? `Guía de talles (Mercado Libre, publicación actual; complemento del modelo):\n${guide}\n\n---\n\n`
        : '';
    const hints = (_c = params.itemSearchHints) === null || _c === void 0 ? void 0 : _c.trim();
    const hintsBlock = hints ? `Datos del ítem para buscar en internet si hace falta:\n${hints}\n\n` : '';
    return (`${catBlock}` +
        `Publicación de Mercado Libre donde está la pregunta (ID ítem: ${params.itemListingId}):\n` +
        `Título: ${params.itemTitle}\n\n` +
        `${hintsBlock}` +
        `${lupoGuideBlock}` +
        `${guideBlock}` +
        `Descripción (texto plano):\n${params.description || '(sin descripción)'}\n\n` +
        `Pregunta del comprador:\n${params.questionText}\n\n` +
        `(Si la pregunta es de talle, recomendá usando la Guía oficial de talles Lupo según el tipo de prenda. Si la respuesta no está en la ficha ni en el catálogo, buscá en internet el producto por título/marca/modelo antes de decir que no tenés el dato.)`);
}
function isGeminiToolConfigError(err) {
    var _a, _b;
    if (!axios_1.default.isAxiosError(err))
        return false;
    const st = (_a = err.response) === null || _a === void 0 ? void 0 : _a.status;
    if (st === 400 || st === 422)
        return true;
    const msg = JSON.stringify(((_b = err.response) === null || _b === void 0 ? void 0 : _b.data) || '').toLowerCase();
    return msg.includes('google_search') || msg.includes('tool') || msg.includes('googlesearch');
}
function callGeminiAnswer(params) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
        const key = (_a = process.env.GEMINI_API_KEY) === null || _a === void 0 ? void 0 : _a.trim();
        if (!key)
            throw new Error('GEMINI_API_KEY no configurada');
        const system = [DEFAULT_SYSTEM, (_b = params.extraSystem) === null || _b === void 0 ? void 0 : _b.trim()].filter(Boolean).join('\n\n');
        const user = params.userPrompt;
        const useWebSearch = webSearchEnabled();
        const timeoutMs = useWebSearch ? 120000 : 60000;
        let lastErr;
        for (const model of geminiModelAttempts()) {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
            const attempts = [];
            if (useWebSearch) {
                attempts.push({
                    label: 'google_search',
                    body: {
                        systemInstruction: { parts: [{ text: system }] },
                        contents: [{ role: 'user', parts: [{ text: user }] }],
                        tools: [{ google_search: {} }],
                        generationConfig: { temperature: 0.4, maxOutputTokens: 4096 }
                    }
                });
                attempts.push({
                    label: 'googleSearch',
                    body: {
                        systemInstruction: { parts: [{ text: system }] },
                        contents: [{ role: 'user', parts: [{ text: user }] }],
                        tools: [{ googleSearch: {} }],
                        generationConfig: { temperature: 0.4, maxOutputTokens: 4096 }
                    }
                });
            }
            attempts.push({
                label: 'plain',
                body: {
                    systemInstruction: { parts: [{ text: system }] },
                    contents: [{ role: 'user', parts: [{ text: user }] }],
                    generationConfig: { temperature: 0.4, maxOutputTokens: 4096 }
                }
            });
            for (const attempt of attempts) {
                if (attempt.label !== 'plain' && !useWebSearch)
                    continue;
                try {
                    const res = yield axios_1.default.post(url, attempt.body, {
                        headers: { 'Content-Type': 'application/json' },
                        timeout: timeoutMs
                    });
                    const cand = (_d = (_c = res.data) === null || _c === void 0 ? void 0 : _c.candidates) === null || _d === void 0 ? void 0 : _d[0];
                    const finish = cand === null || cand === void 0 ? void 0 : cand.finishReason;
                    if (finish && finish !== 'STOP') {
                        console.warn(`[ML Questions AI] Gemini finishReason=${finish} (respuesta puede estar incompleta)`);
                    }
                    const grounding = (_g = (_f = (_e = res.data) === null || _e === void 0 ? void 0 : _e.candidates) === null || _f === void 0 ? void 0 : _f[0]) === null || _g === void 0 ? void 0 : _g.groundingMetadata;
                    if (grounding && attempt.label !== 'plain') {
                        const queries = (grounding === null || grounding === void 0 ? void 0 : grounding.webSearchQueries) || (grounding === null || grounding === void 0 ? void 0 : grounding.searchEntryPoint);
                        console.log('[ML Questions AI] Gemini usó búsqueda web', queries ? JSON.stringify(queries).slice(0, 200) : '');
                    }
                    const block = finish && finish !== 'STOP' ? ` (${finish})` : '';
                    const text = ((_k = (_j = (_h = cand === null || cand === void 0 ? void 0 : cand.content) === null || _h === void 0 ? void 0 : _h.parts) === null || _j === void 0 ? void 0 : _j.map((p) => p.text || '').join('')) === null || _k === void 0 ? void 0 : _k.trim()) || '';
                    if (!text)
                        throw new Error(`Gemini no devolvió texto${block}`);
                    return truncateAnswer(text);
                }
                catch (err) {
                    lastErr = err;
                    if (attempt.label !== 'plain' && isGeminiToolConfigError(err)) {
                        console.warn(`[ML Questions AI] Búsqueda web no disponible (${model}, ${attempt.label}), probando…`);
                        continue;
                    }
                    if (isGeminiModelNotFound(err))
                        break;
                    if (attempt.label === 'plain')
                        throw err;
                }
            }
            if (isGeminiModelNotFound(lastErr)) {
                console.warn(`[ML Questions AI] Modelo Gemini no disponible (${model}), probando siguiente…`);
                continue;
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
            max_tokens: 2048
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
            max_tokens: 2048
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
function callOllamaAnswer(params) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g;
        const model = ((_a = process.env.OLLAMA_MODEL) === null || _a === void 0 ? void 0 : _a.trim()) || 'llama3.2';
        const system = [DEFAULT_SYSTEM, (_b = params.extraSystem) === null || _b === void 0 ? void 0 : _b.trim()].filter(Boolean).join('\n\n');
        const url = `${ollamaBaseUrl()}/v1/chat/completions`;
        const timeoutMs = Math.min(300000, Math.max(30000, parseInt(process.env.OLLAMA_TIMEOUT_MS || '120000', 10) || 120000));
        const res = yield axios_1.default.post(url, {
            model,
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: params.userPrompt }
            ],
            temperature: 0.4,
            stream: false
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: timeoutMs
        });
        const text = (_g = (_f = (_e = (_d = (_c = res.data) === null || _c === void 0 ? void 0 : _c.choices) === null || _d === void 0 ? void 0 : _d[0]) === null || _e === void 0 ? void 0 : _e.message) === null || _f === void 0 ? void 0 : _f.content) === null || _g === void 0 ? void 0 : _g.trim();
        if (!text)
            throw new Error('Ollama no devolvió texto');
        return truncateAnswer(text);
    });
}
function generateLlmAnswer(params) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const provider = resolveProvider();
        if (!provider) {
            throw new Error('Ningún proveedor de IA configurado. Opciones: GEMINI_API_KEY, GROQ_API_KEY, OPENAI_API_KEY, o Ollama local (LLM_PROVIDER=ollama).');
        }
        const userPrompt = buildMlQuestionUserPrompt({
            catalogSummary: params.catalogSummary,
            itemListingId: params.itemListingId,
            itemTitle: params.itemTitle,
            itemSearchHints: params.itemSearchHints,
            description: params.description,
            sizeGuideFromMl: (_a = params.sizeGuideFromMl) !== null && _a !== void 0 ? _a : '',
            questionText: params.questionText
        });
        const common = { userPrompt, extraSystem: params.extraSystem };
        if (provider === 'gemini')
            return callGeminiAnswer(common);
        if (provider === 'groq')
            return callGroqAnswer(common);
        if (provider === 'ollama')
            return callOllamaAnswer(common);
        return callOpenAiAnswer(common);
    });
}
/** ML suele aceptar hasta ~2000 caracteres por respuesta; recortamos solo si el modelo se pasara. */
function truncateAnswer(s, max = 2000) {
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
        const res = yield mlGet(accessToken, `/items/${encodeURIComponent(itemId)}`, {
            include_attributes: 'all'
        });
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
/** Valor del atributo SIZE_GRID_ID en ítems ML (ID numérico de la tabla en /catalog/charts). */
function extractSizeGridIdFromItem(item) {
    const pick = (attrs) => {
        if (!Array.isArray(attrs))
            return null;
        const a = attrs.find((x) => String((x === null || x === void 0 ? void 0 : x.id) || '').toUpperCase() === 'SIZE_GRID_ID');
        if (!a)
            return null;
        const vid = a.value_id;
        if (vid != null && String(vid).trim() !== '')
            return String(vid).trim();
        if (Array.isArray(a.values) && a.values.length) {
            const first = a.values[0];
            if ((first === null || first === void 0 ? void 0 : first.id) != null && String(first.id).trim() !== '')
                return String(first.id).trim();
            const n = first === null || first === void 0 ? void 0 : first.name;
            if (n != null && /^\d+$/.test(String(n).trim()))
                return String(n).trim();
        }
        return null;
    };
    let id = pick(item === null || item === void 0 ? void 0 : item.attributes);
    if (id)
        return id;
    const vars = item === null || item === void 0 ? void 0 : item.variations;
    if (Array.isArray(vars)) {
        for (const v of vars) {
            id = pick(v === null || v === void 0 ? void 0 : v.attributes);
            if (id)
                return id;
        }
    }
    return null;
}
/** Convierte la respuesta de GET /catalog/charts/{id} en texto para el prompt. */
function formatMlSizeChartForPrompt(chart) {
    var _a;
    if (!chart || typeof chart !== 'object')
        return '';
    const lines = [];
    const names = chart.names && typeof chart.names === 'object' ? chart.names : {};
    const nameStr = (_a = [names.MLA, names.MLB, names.MLC, names.MLU]
        .find((n) => typeof n === 'string' && n.trim())) !== null && _a !== void 0 ? _a : Object.values(names).find((n) => typeof n === 'string' && String(n).trim());
    if (nameStr)
        lines.push(`Nombre de la guía: ${nameStr}`);
    if (chart.id != null)
        lines.push(`ID tabla ML: ${chart.id}`);
    const rows = Array.isArray(chart.rows) ? chart.rows : [];
    for (const row of rows) {
        const bits = [];
        const attrs = Array.isArray(row === null || row === void 0 ? void 0 : row.attributes) ? row.attributes : [];
        for (const att of attrs) {
            const label = (att.name || att.id || '').toString().trim();
            const vals = Array.isArray(att.values) ? att.values : [];
            const parts = [];
            for (const v of vals) {
                if ((v === null || v === void 0 ? void 0 : v.name) != null && String(v.name).trim())
                    parts.push(String(v.name).trim());
                else if ((v === null || v === void 0 ? void 0 : v.struct) && typeof v.struct.number === 'number') {
                    const u = v.struct.unit ? ` ${v.struct.unit}` : '';
                    parts.push(`${v.struct.number}${u}`);
                }
            }
            if (label && parts.length)
                bits.push(`${label}: ${parts.join(' / ')}`);
        }
        if (bits.length)
            lines.push(`- ${bits.join(' | ')}`);
    }
    let text = lines.join('\n').trim();
    if (text.length > ML_SIZE_CHART_MAX_CHARS) {
        text = text.slice(0, ML_SIZE_CHART_MAX_CHARS - 40) + '\n… (guía truncada por límite de contexto)';
    }
    return text;
}
function fetchMlSizeChartForPrompt(accessToken, chartId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const id = String(chartId || '').trim();
        if (!id)
            return '';
        try {
            /** /catalog/charts no usa el mismo contrato que /items; evitamos api_version en query. */
            const res = yield axios_1.default.get(`${ML_API}/catalog/charts/${encodeURIComponent(id)}`, {
                headers: { Authorization: `Bearer ${accessToken}` },
                timeout: 45000
            });
            return formatMlSizeChartForPrompt(res.data);
        }
        catch (e) {
            const st = (_a = e === null || e === void 0 ? void 0 : e.response) === null || _a === void 0 ? void 0 : _a.status;
            console.warn('[ML Questions AI] Guía de talles:', id, st || (e === null || e === void 0 ? void 0 : e.message) || e);
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
function loadQuestionContext(accessToken, questionId) {
    return __awaiter(this, void 0, void 0, function* () {
        const q = yield fetchQuestion(accessToken, questionId);
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
        const item = yield fetchItem(accessToken, itemId);
        const title = String((item === null || item === void 0 ? void 0 : item.title) || '(sin título)');
        const itemSearchHints = extractItemSearchHints(item);
        const description = yield fetchDescription(accessToken, itemId);
        const sizeGridId = extractSizeGridIdFromItem(item);
        const sizeGuideFromMl = sizeGridId ? yield fetchMlSizeChartForPrompt(accessToken, sizeGridId) : '';
        const catalogSummary = yield getCachedCatalogSummary();
        return {
            questionId,
            itemId,
            questionText,
            itemTitle: title,
            itemSearchHints,
            description,
            sizeGuideFromMl,
            catalogSummary
        };
    });
}
function generateAnswerFromContext(ctx, extraSystemPrompt) {
    return __awaiter(this, void 0, void 0, function* () {
        return generateLlmAnswer({
            itemTitle: ctx.itemTitle,
            itemSearchHints: ctx.itemSearchHints,
            description: ctx.description,
            questionText: ctx.questionText,
            extraSystem: extraSystemPrompt,
            catalogSummary: ctx.catalogSummary,
            itemListingId: ctx.itemId,
            sizeGuideFromMl: ctx.sizeGuideFromMl
        });
    });
}
function publishAnswerToMl(accessToken, questionId, answerText, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const final = truncateAnswer(answerText);
        yield mlPost(accessToken, '/answers', {
            question_id: Number(questionId),
            text: final
        });
        yield recordSuggestionSent(questionId, {
            sentText: final,
            originalSuggestionText: opts === null || opts === void 0 ? void 0 : opts.originalSuggestionText,
            sentSource: (_a = opts === null || opts === void 0 ? void 0 : opts.sentSource) !== null && _a !== void 0 ? _a : 'review'
        });
    });
}
/** Genera sugerencia IA sin publicar en Mercado Libre. */
function suggestForQuestion(accessToken, questionId, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        const loaded = yield loadQuestionContext(accessToken, questionId);
        if ('status' in loaded)
            return loaded;
        const ctx = loaded;
        if (!(opts === null || opts === void 0 ? void 0 : opts.forceRegenerate)) {
            const existing = yield getSuggestionByQuestionId(questionId);
            if ((existing === null || existing === void 0 ? void 0 : existing.status) === 'pending' && existing.suggestionText.trim()) {
                return { questionId, status: 'suggested', preview: existing.suggestionText.slice(0, 160) };
            }
        }
        const provider = resolveProvider();
        const answerText = yield generateAnswerFromContext(ctx, opts === null || opts === void 0 ? void 0 : opts.extraSystemPrompt);
        yield upsertSuggestion({
            questionId,
            itemId: ctx.itemId,
            questionText: ctx.questionText,
            suggestionText: answerText,
            status: 'pending',
            llmProvider: provider
        });
        return { questionId, status: 'suggested', preview: answerText.slice(0, 160) };
    });
}
function approveAndSendSuggestion(accessToken, questionId, text) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const loaded = yield loadQuestionContext(accessToken, questionId);
        if ('status' in loaded)
            return loaded;
        let answerText = (text !== null && text !== void 0 ? text : '').trim();
        if (!answerText) {
            const existing = yield getSuggestionByQuestionId(questionId);
            answerText = ((_a = existing === null || existing === void 0 ? void 0 : existing.suggestionText) === null || _a === void 0 ? void 0 : _a.trim()) || '';
        }
        if (!answerText) {
            return { questionId, status: 'error', message: 'No hay texto de respuesta' };
        }
        const existing = yield getSuggestionByQuestionId(questionId);
        yield publishAnswerToMl(accessToken, questionId, answerText, {
            sentSource: 'review',
            originalSuggestionText: (_b = existing === null || existing === void 0 ? void 0 : existing.suggestionText) !== null && _b !== void 0 ? _b : answerText
        });
        return { questionId, status: 'answered', preview: answerText.slice(0, 160) };
    });
}
function processOneQuestion(accessToken, questionId, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const mode = (_a = opts === null || opts === void 0 ? void 0 : opts.mode) !== null && _a !== void 0 ? _a : 'auto';
        if (mode === 'off') {
            return { questionId, status: 'skipped', reason: 'IA desactivada' };
        }
        if (mode === 'suggest') {
            return suggestForQuestion(accessToken, questionId, { extraSystemPrompt: opts === null || opts === void 0 ? void 0 : opts.extraSystemPrompt });
        }
        const loaded = yield loadQuestionContext(accessToken, questionId);
        if ('status' in loaded)
            return loaded;
        const ctx = loaded;
        const answerText = yield generateAnswerFromContext(ctx, opts === null || opts === void 0 ? void 0 : opts.extraSystemPrompt);
        const provider = resolveProvider();
        yield upsertSuggestion({
            questionId,
            itemId: ctx.itemId,
            questionText: ctx.questionText,
            suggestionText: answerText,
            status: 'pending',
            llmProvider: provider
        });
        yield publishAnswerToMl(accessToken, questionId, answerText, {
            sentSource: 'auto',
            originalSuggestionText: answerText
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
                    extraSystemPrompt: opts === null || opts === void 0 ? void 0 : opts.extraSystemPrompt,
                    mode: opts === null || opts === void 0 ? void 0 : opts.mode
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
/** Si la configuración y el LLM están activos, procesa preguntas sin responder (webhook o cron). */
function runMlQuestionsAiIfEnabled(getToken, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const cfg = yield getMlQuestionsAiConfigRow();
        if (cfg.mode === 'off') {
            return { ran: false, message: 'IA de preguntas desactivada' };
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
            extraSystemPrompt: cfg.extraSystemPrompt,
            mode: cfg.mode
        });
        return { ran: true, processed, results };
    });
}
