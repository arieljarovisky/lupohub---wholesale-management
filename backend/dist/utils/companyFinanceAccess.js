"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCompanyFinanceUser = exports.getCompanyFinanceAllowedEmails = exports.normalizeFinanceEmail = void 0;
const DEFAULT_EMAILS = ['ariel@lupo.ar', 'suny@lupo.ar'];
function normalizeFinanceEmail(value) {
    return String(value || '').trim().toLowerCase();
}
exports.normalizeFinanceEmail = normalizeFinanceEmail;
function getCompanyFinanceAllowedEmails() {
    const fromEnv = (process.env.LUPOHUB_COMPANY_FINANCE_EMAILS || '')
        .split(',')
        .map((e) => normalizeFinanceEmail(e))
        .filter((e) => e.includes('@'));
    const merged = [...DEFAULT_EMAILS.map(normalizeFinanceEmail), ...fromEnv];
    return Array.from(new Set(merged));
}
exports.getCompanyFinanceAllowedEmails = getCompanyFinanceAllowedEmails;
function isCompanyFinanceUser(email) {
    const normalized = normalizeFinanceEmail(email);
    if (!normalized)
        return false;
    return getCompanyFinanceAllowedEmails().includes(normalized);
}
exports.isCompanyFinanceUser = isCompanyFinanceUser;
