const DEFAULT_EMAILS = ['ariel@lupo.ar', 'suny@lupo.ar'];

export function normalizeFinanceEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

export function getCompanyFinanceAllowedEmails(): string[] {
  const fromEnv = (process.env.LUPOHUB_COMPANY_FINANCE_EMAILS || '')
    .split(',')
    .map((e) => normalizeFinanceEmail(e))
    .filter((e) => e.includes('@'));
  const merged = [...DEFAULT_EMAILS.map(normalizeFinanceEmail), ...fromEnv];
  return Array.from(new Set(merged));
}

export function isCompanyFinanceUser(email: unknown): boolean {
  const normalized = normalizeFinanceEmail(email);
  if (!normalized) return false;
  return getCompanyFinanceAllowedEmails().includes(normalized);
}
