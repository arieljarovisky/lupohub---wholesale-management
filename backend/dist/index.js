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
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const products_routes_1 = __importDefault(require("./routes/products.routes"));
const orders_routes_1 = __importDefault(require("./routes/orders.routes"));
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const colors_routes_1 = __importDefault(require("./routes/colors.routes"));
const sizes_routes_1 = __importDefault(require("./routes/sizes.routes"));
const integrations_routes_1 = __importDefault(require("./routes/integrations.routes"));
const stock_routes_1 = __importDefault(require("./routes/stock.routes"));
const despachos_routes_1 = __importDefault(require("./routes/despachos.routes"));
const users_routes_1 = __importDefault(require("./routes/users.routes"));
const customers_routes_1 = __importDefault(require("./routes/customers.routes"));
const transportes_routes_1 = __importDefault(require("./routes/transportes.routes"));
const price_lists_routes_1 = __importDefault(require("./routes/price_lists.routes"));
const catalogs_routes_1 = __importDefault(require("./routes/catalogs.routes"));
const billing_routes_1 = __importDefault(require("./routes/billing.routes"));
const afip_routes_1 = __importDefault(require("./routes/afip.routes"));
const payments_routes_1 = __importDefault(require("./routes/payments.routes"));
const add_stock_movements_table_1 = require("./database/add_stock_movements_table");
const add_dispatched_at_orders_1 = require("./database/add_dispatched_at_orders");
const fix_integrations_table_1 = require("./database/fix_integrations_table");
const add_despachos_table_1 = require("./database/add_despachos_table");
const add_pack_size_products_1 = require("./database/add_pack_size_products");
const add_order_item_sell_as_pack_1 = require("./database/add_order_item_sell_as_pack");
const add_order_item_despacho_id_1 = require("./database/add_order_item_despacho_id");
const add_variant_publications_table_1 = require("./database/add_variant_publications_table");
const add_external_sku_1 = require("./database/add_external_sku");
const add_mercado_libre_item_id_1 = require("./database/add_mercado_libre_item_id");
const add_customer_direct_1 = require("./database/add_customer_direct");
const add_customer_cuit_1 = require("./database/add_customer_cuit");
const add_customer_phone_iva_1 = require("./database/add_customer_phone_iva");
const add_transportes_tables_1 = require("./database/add_transportes_tables");
const add_invoices_table_1 = require("./database/add_invoices_table");
const add_credit_notes_table_1 = require("./database/add_credit_notes_table");
const add_credit_note_items_table_1 = require("./database/add_credit_note_items_table");
const add_orders_archived_1 = require("./database/add_orders_archived");
const add_price_lists_1 = require("./database/add_price_lists");
const add_catalogs_table_1 = require("./database/add_catalogs_table");
const add_remitente_table_1 = require("./database/add_remitente_table");
const add_payment_status_orders_1 = require("./database/add_payment_status_orders");
const add_payments_table_1 = require("./database/add_payments_table");
const add_no_stock_impact_orders_1 = require("./database/add_no_stock_impact_orders");
const add_order_reference_orders_1 = require("./database/add_order_reference_orders");
const add_customer_invoice_fields_1 = require("./database/add_customer_invoice_fields");
const add_external_invoices_table_1 = require("./database/add_external_invoices_table");
const add_external_credit_notes_table_1 = require("./database/add_external_credit_notes_table");
const add_customer_multimedia_ledger_1 = require("./database/add_customer_multimedia_ledger");
const add_lupo_stock_webhook_config_table_1 = require("./database/add_lupo_stock_webhook_config_table");
const add_variant_luposhop_stock_table_1 = require("./database/add_variant_luposhop_stock_table");
const add_products_archived_1 = require("./database/add_products_archived");
const init_schema_1 = require("./database/init_schema");
const ensure_admin_user_1 = require("./database/ensure_admin_user");
const db_1 = require("./database/db");
const integrations_controller_1 = require("./controllers/integrations.controller");
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
// CORS: con credentials (cookies) no se puede usar '*'; hay que devolver el origen concreto
const allowedOrigins = [
    'https://lupohub-wholesale-management.vercel.app',
    'http://localhost:5173',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:3000'
];
const frontendUrl = (_a = process.env.FRONTEND_URL) === null || _a === void 0 ? void 0 : _a.replace(/\/$/, '');
if (frontendUrl && !allowedOrigins.includes(frontendUrl))
    allowedOrigins.push(frontendUrl);
function isAllowedOrigin(origin) {
    if (!origin)
        return true;
    if (allowedOrigins.includes(origin))
        return true;
    // Permitir previews de Vercel del proyecto (ej: lupohub-wholesale-management-git-...vercel.app)
    if (/^https:\/\/lupohub-wholesale-management(?:-[a-z0-9-]+)?\.vercel\.app$/i.test(origin))
        return true;
    return false;
}
const corsOpts = {
    origin: (origin, cb) => {
        if (isAllowedOrigin(origin))
            return cb(null, true);
        cb(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};
app.use((0, cors_1.default)(corsOpts));
app.options('*', (0, cors_1.default)(corsOpts));
app.use(express_1.default.json());
app.use((req, res, next) => {
    console.log('[backend]', req.method, req.path);
    next();
});
// Routes
app.use('/api/products', products_routes_1.default);
app.use('/api/orders', orders_routes_1.default);
app.use('/api/colors', colors_routes_1.default);
app.use('/api/sizes', sizes_routes_1.default);
app.use('/api/auth', auth_routes_1.default);
app.use('/api/integrations', integrations_routes_1.default);
app.use('/api/stock', stock_routes_1.default);
app.use('/api/despachos', despachos_routes_1.default);
app.use('/api/users', users_routes_1.default);
app.use('/api/customers', customers_routes_1.default);
app.use('/api/transportes', transportes_routes_1.default);
app.use('/api/price-lists', price_lists_routes_1.default);
app.use('/api/catalogs', catalogs_routes_1.default);
app.use('/api/afip', afip_routes_1.default);
app.use('/api/billing', billing_routes_1.default);
app.use('/api/payments', payments_routes_1.default);
// Manejador global de errores: devuelve JSON con el mensaje para que el front pueda mostrarlo
app.use((err, _req, res, _next) => {
    const message = (err === null || err === void 0 ? void 0 : err.message) || String(err) || 'Error interno del servidor';
    if (!res.headersSent)
        res.status(500).json({ error: message, message });
});
// Health Check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', service: 'LupoHub Backend', db: 'MySQL' });
});
// Initialize database tables (con reintentos por si MySQL tarda en Railway)
function initDatabase() {
    return __awaiter(this, void 0, void 0, function* () {
        const maxAttempts = 5;
        const delayMs = 3000;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                console.log(`[DB] Intento ${attempt}/${maxAttempts} de conectar a MySQL...`);
                yield (0, db_1.testConnection)();
                console.log('[DB] Conexión OK, creando/verificando tablas...');
                yield (0, init_schema_1.initSchema)();
                yield (0, ensure_admin_user_1.ensureAdminUser)();
                yield (0, add_stock_movements_table_1.addStockMovementsTable)();
                yield (0, add_dispatched_at_orders_1.addDispatchedAtToOrders)();
                yield (0, fix_integrations_table_1.fixIntegrationsTable)();
                yield (0, add_despachos_table_1.addDespachosTable)();
                yield (0, add_pack_size_products_1.addPackSizeToProducts)();
                yield (0, add_order_item_sell_as_pack_1.addOrderItemSellAsPack)();
                yield (0, add_order_item_despacho_id_1.addOrderItemDespachoId)();
                yield (0, add_variant_publications_table_1.addVariantPublicationsTable)();
                yield (0, add_external_sku_1.addExternalSkuToVariants)();
                yield (0, add_mercado_libre_item_id_1.addMercadoLibreItemIdToVariants)();
                yield (0, add_customer_direct_1.addCustomerDirect)();
                yield (0, add_customer_cuit_1.addCustomerCuit)();
                yield (0, add_customer_phone_iva_1.addCustomerPhoneIva)();
                yield (0, add_transportes_tables_1.addTransportesTables)();
                yield (0, add_invoices_table_1.addInvoicesTable)();
                yield (0, add_credit_notes_table_1.addCreditNotesTable)();
                yield (0, add_credit_note_items_table_1.addCreditNoteItemsTable)();
                yield (0, add_orders_archived_1.addOrdersArchived)();
                yield (0, add_price_lists_1.addPriceLists)();
                yield (0, add_catalogs_table_1.addCatalogsTable)();
                yield (0, add_remitente_table_1.addRemitenteTable)();
                yield (0, add_payment_status_orders_1.addPaymentStatusToOrders)();
                yield (0, add_payments_table_1.addPaymentsTable)();
                yield (0, add_no_stock_impact_orders_1.addNoStockImpactToOrders)();
                yield (0, add_products_archived_1.addProductsArchived)();
                yield (0, add_order_reference_orders_1.addOrderReferenceToOrders)();
                yield (0, add_customer_invoice_fields_1.addCustomerInvoiceFields)();
                yield (0, add_external_invoices_table_1.addExternalInvoicesTable)();
                yield (0, add_external_credit_notes_table_1.addExternalCreditNotesTable)();
                yield (0, add_customer_multimedia_ledger_1.addCustomerMultimediaLedger)();
                yield (0, add_lupo_stock_webhook_config_table_1.addLupoStockWebhookConfigTable)();
                yield (0, add_variant_luposhop_stock_table_1.addVariantLuposhopStockTable)();
                console.log('[DB] Tablas inicializadas correctamente');
                return;
            }
            catch (err) {
                console.error(`[DB] Intento ${attempt} fallido:`, (err === null || err === void 0 ? void 0 : err.code) || (err === null || err === void 0 ? void 0 : err.message));
                if (attempt < maxAttempts) {
                    console.log(`[DB] Reintento en ${delayMs / 1000}s...`);
                    yield new Promise(r => setTimeout(r, delayMs));
                }
                else {
                    console.error('[DB] No se pudo conectar después de', maxAttempts, 'intentos. Revisá que MYSQL_URL esté definida (Variable Reference al servicio MySQL) y que ambos servicios estén en el mismo proyecto.');
                }
            }
        }
    });
}
initDatabase().catch(console.error);
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    const intervalMin = Math.max(1, parseInt(process.env.SYNC_ML_TN_INTERVAL_MINUTES || '30', 10));
    const intervalMs = intervalMin * 60 * 1000;
    if (process.env.SYNC_ML_TN_AUTO !== '0' && process.env.SYNC_ML_TN_AUTO !== 'false') {
        (0, integrations_controller_1.runAutoSyncMLtoTN)().catch(() => { });
        setInterval(() => (0, integrations_controller_1.runAutoSyncMLtoTN)().catch(() => { }), intervalMs);
        console.log(`[AutoSync] ML → TN cada ${intervalMin} min`);
    }
});
