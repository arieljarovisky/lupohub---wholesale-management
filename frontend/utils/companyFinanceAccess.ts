export const COMPANY_FINANCE_VIEW = 'company_finance';

const ALLOWED_EMAILS = ['ariel@lupo.ar', 'suny@lupo.ar'];

export function normalizeFinanceEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

export function isCompanyFinanceUser(email: unknown): boolean {
  const normalized = normalizeFinanceEmail(email);
  return normalized.length > 0 && ALLOWED_EMAILS.includes(normalized);
}
