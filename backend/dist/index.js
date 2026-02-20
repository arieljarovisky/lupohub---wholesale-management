"use strict";
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
app.use('/api/products', products_routes_1.default); // Disabled auth for demo/debugging purposes, or fix frontend token
app.use('/api/orders', orders_routes_1.default);
app.use('/api/colors', colors_routes_1.default);
app.use('/api/sizes', sizes_routes_1.default);
app.use('/api/auth', auth_routes_1.default);
app.use('/api/integrations', integrations_routes_1.default);
// Health Check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', service: 'LupoHub Backend', db: 'MySQL' });
});
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
