"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.addVariantPublicationsTable = void 0;
/**
 * Tabla variant_publications: permite vincular una variante con varias publicaciones
 * (ej. misma variante en ML por unidad y en ML por pack, o en TN en dos productos distintos).
 * Cada publicación tiene su propio pack_size para el stock enviado.
 */
const db_1 = require("./db");
const addVariantPublicationsTable = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const tableExists = yield (0, db_1.query)(`SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'variant_publications'`);
        if (tableExists && tableExists.length > 0) {
            console.log('✓ Tabla variant_publications ya existe');
            yield migrateExistingLinksToVariantPublications();
            return;
        }
        yield (0, db_1.execute)(`
      CREATE TABLE variant_publications (
        id VARCHAR(36) PRIMARY KEY,
        variant_id VARCHAR(36) NOT NULL,
        platform VARCHAR(50) NOT NULL,
        external_product_id VARCHAR(100) NOT NULL,
        external_variant_id VARCHAR(100) NOT NULL DEFAULT '',
        pack_size INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE,
        UNIQUE KEY uq_variant_platform_external (variant_id, platform, external_product_id, external_variant_id)
      )
    `);
        console.log('✓ Tabla variant_publications creada');
        yield migrateExistingLinksToVariantPublications();
    }
    catch (e) {
        console.error('[variant_publications] Error:', e.message);
        throw e;
    }
});
exports.addVariantPublicationsTable = addVariantPublicationsTable;
function migrateExistingLinksToVariantPublications() {
    return __awaiter(this, void 0, void 0, function* () {
        const { v4: uuidv4 } = yield Promise.resolve().then(() => __importStar(require('uuid')));
        const rows = yield (0, db_1.query)(`
    SELECT pv.id AS variant_id, p.tienda_nube_id AS tn_product_id, pv.tienda_nube_variant_id AS tn_variant_id,
           p.tienda_nube_pack_size AS tn_pack,
           p.mercado_libre_id AS ml_product_id, pv.mercado_libre_variant_id AS ml_variant_id, pv.mercado_libre_item_id AS ml_item_id,
           COALESCE(NULLIF(p.mercado_libre_pack_size, 0), 1) AS ml_pack
    FROM product_variants pv
    JOIN product_colors pc ON pc.id = pv.product_color_id
    JOIN products p ON p.id = pc.product_id
    WHERE pv.tienda_nube_variant_id IS NOT NULL AND pv.tienda_nube_variant_id != ''
       OR pv.mercado_libre_variant_id IS NOT NULL AND pv.mercado_libre_variant_id != ''
       OR pv.mercado_libre_item_id IS NOT NULL AND pv.mercado_libre_item_id != ''
  `);
        let inserted = 0;
        for (const r of rows) {
            const tnPack = Math.max(1, Number(r.tn_pack) || 1);
            const mlPack = Math.max(1, Number(r.ml_pack) || 1);
            if (r.tn_product_id && r.tn_variant_id) {
                const existing = yield (0, db_1.query)(`SELECT id FROM variant_publications WHERE variant_id = ? AND platform = 'tiendanube' AND external_product_id = ? AND external_variant_id = ?`, [r.variant_id, r.tn_product_id, r.tn_variant_id]);
                if (!(existing === null || existing === void 0 ? void 0 : existing.length)) {
                    yield (0, db_1.execute)(`INSERT INTO variant_publications (id, variant_id, platform, external_product_id, external_variant_id, pack_size) VALUES (?, ?, 'tiendanube', ?, ?, ?)`, [uuidv4(), r.variant_id, r.tn_product_id, r.tn_variant_id, tnPack]);
                    inserted++;
                }
            }
            const mlProductId = r.ml_item_id || r.ml_product_id;
            const mlVariantId = (r.ml_variant_id && String(r.ml_variant_id).trim()) || '';
            if (mlProductId) {
                const existing = yield (0, db_1.query)(`SELECT id FROM variant_publications WHERE variant_id = ? AND platform = 'mercadolibre' AND external_product_id = ? AND external_variant_id = ?`, [r.variant_id, mlProductId, mlVariantId]);
                if (!(existing === null || existing === void 0 ? void 0 : existing.length)) {
                    yield (0, db_1.execute)(`INSERT INTO variant_publications (id, variant_id, platform, external_product_id, external_variant_id, pack_size) VALUES (?, ?, 'mercadolibre', ?, ?, ?)`, [uuidv4(), r.variant_id, mlProductId, mlVariantId, mlPack]);
                    inserted++;
                }
            }
        }
        if (inserted > 0) {
            console.log(`✓ Migrados ${inserted} enlaces existentes a variant_publications`);
        }
    });
}
