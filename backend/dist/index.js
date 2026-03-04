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
const add_stock_movements_table_1 = require("./database/add_stock_movements_table");
const add_dispatched_at_orders_1 = require("./database/add_dispatched_at_orders");
const fix_integrations_table_1 = require("./database/fix_integrations_table");
const add_despachos_table_1 = require("./database/add_despachos_table");
const init_schema_1 = require("./database/init_schema");
const ensure_admin_user_1 = require("./database/ensure_admin_user");
const db_1 = require("./database/db");
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
// Middleware
app.use((0, cors_1.default)());
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
});
