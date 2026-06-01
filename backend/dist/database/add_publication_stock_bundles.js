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
Object.defineProperty(exports, "__esModule", { value: true });
exports.addPublicationStockBundles = void 0;
/**
 * Packs de publicación: una publicación ML/TN descuenta stock de varias variantes (ej. pack 3 boxer: 1 negro + 1 gris + 1 blanco).
 */
const db_1 = require("./db");
function addPublicationStockBundles() {
    return __awaiter(this, void 0, void 0, function* () {
        const tableExists = yield (0, db_1.query)(`SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'publication_stock_bundles'`);
        if (Array.isArray(tableExists) && tableExists.length > 0) {
            console.log('[DB] Tablas publication_stock_bundles ya existen');
            return;
        }
        yield (0, db_1.execute)(`
    CREATE TABLE publication_stock_bundles (
      id VARCHAR(36) PRIMARY KEY,
      platform VARCHAR(50) NOT NULL,
      external_product_id VARCHAR(100) NOT NULL,
      external_variant_id VARCHAR(100) NOT NULL DEFAULT '',
      label VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_pub_bundle_listing (platform, external_product_id, external_variant_id)
    )
  `);
        yield (0, db_1.execute)(`
    CREATE TABLE publication_stock_bundle_items (
      id VARCHAR(36) PRIMARY KEY,
      bundle_id VARCHAR(36) NOT NULL,
      variant_id VARCHAR(36) NOT NULL,
      units_per_sale INT NOT NULL DEFAULT 1,
      sort_order INT NOT NULL DEFAULT 0,
      FOREIGN KEY (bundle_id) REFERENCES publication_stock_bundles(id) ON DELETE CASCADE,
      FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE,
      UNIQUE KEY uq_bundle_variant (bundle_id, variant_id)
    )
  `);
        console.log('[DB] Tablas publication_stock_bundles y publication_stock_bundle_items creadas');
    });
}
exports.addPublicationStockBundles = addPublicationStockBundles;
