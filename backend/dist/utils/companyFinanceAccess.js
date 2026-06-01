"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeFinanceEmail = normalizeFinanceEmail;
exports.getCompanyFinanceAllowedEmails = getCompanyFinanceAllowedEmails;
exports.isCompanyFinanceUser = isCompanyFinanceUser;
const DEFAULT_EMAILS = ['ariel@lupo.ar', 'suny@lupo.ar'];
function normalizeFinanceEmail(value) {
    return String(value || '').trim().toLowerCase();
}
function getCompanyFinanceAllowedEmails() {
    const fromEnv = (process.env.LUPOHUB_COMPANY_FINANCE_EMAILS || '')
        .split(',')
        .map((e) => normalizeFinanceEmail(e))
        .filter((e) => e.includes('@'));
    const merged = [...DEFAULT_EMAILS.map(normalizeFinanceEmail), ...fromEnv];
    return Array.from(new Set(merged));
}
function isCompanyFinanceUser(email) {
    const normalized = normalizeFinanceEmail(email);
    if (!normalized)
        return false;
    return getCompanyFinanceAllowedEmails().includes(normalized);
}
