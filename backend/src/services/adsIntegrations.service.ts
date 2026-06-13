import { get, execute } from '../database/db';

export type MetaAdsConfig = {
  accessToken: string;
  accountId: string;
};

export type GoogleAdsConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  developerToken: string;
  customerId: string;
  loginCustomerId?: string;
};

export type MetaAdsConfigUi = {
  configured: boolean;
  accountId: string;
  hasToken: boolean;
  source: 'db' | 'env' | null;
};

export type GoogleAdsConfigUi = {
  configured: boolean;
  customerId: string;
  loginCustomerId: string;
  hasRefreshToken: boolean;
  hasDeveloperToken: boolean;
  hasClientCredentials: boolean;
  source: 'db' | 'env' | null;
};

async function readIntegration(platform: string): Promise<{
  access_token?: string | null;
  refresh_token?: string | null;
  user_id?: string | null;
  store_id?: string | null;
} | null> {
  return get(
    'SELECT access_token, refresh_token, user_id, store_id FROM integrations WHERE platform = ?',
    [platform]
  );
}

export async function getMetaAdsConfig(): Promise<MetaAdsConfig | null> {
  const row = await readIntegration('meta_ads');
  const token = row?.access_token?.trim() || process.env.META_ADS_ACCESS_TOKEN?.trim();
  const accountId = row?.user_id?.trim() || process.env.META_ADS_ACCOUNT_ID?.trim();
  if (!token || !accountId) return null;
  return { accessToken: token, accountId: accountId.replace(/^act_/i, '') };
}

export async function getGoogleAdsConfig(): Promise<GoogleAdsConfig | null> {
  const row = await readIntegration('google_ads');
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID?.trim() || '';
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET?.trim() || '';
  const refreshToken = row?.refresh_token?.trim() || process.env.GOOGLE_ADS_REFRESH_TOKEN?.trim();
  const developerToken =
    row?.access_token?.trim() || process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
  const customerId = row?.user_id?.trim() || process.env.GOOGLE_ADS_CUSTOMER_ID?.trim();
  const loginCustomerId = row?.store_id?.trim() || process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.trim();

  if (!refreshToken || !developerToken || !customerId || !clientId || !clientSecret) return null;

  return {
    clientId,
    clientSecret,
    refreshToken,
    developerToken,
    customerId: customerId.replace(/-/g, ''),
    loginCustomerId: loginCustomerId ? loginCustomerId.replace(/-/g, '') : undefined
  };
}

export async function getMetaAdsConfigForUi(): Promise<MetaAdsConfigUi> {
  const row = await readIntegration('meta_ads');
  const envToken = process.env.META_ADS_ACCESS_TOKEN?.trim();
  const envAccount = process.env.META_ADS_ACCOUNT_ID?.trim();
  const dbToken = row?.access_token?.trim();
  const dbAccount = row?.user_id?.trim();

  if (dbToken && dbAccount) {
    return { configured: true, accountId: dbAccount, hasToken: true, source: 'db' };
  }
  if (envToken && envAccount) {
    return { configured: true, accountId: envAccount, hasToken: true, source: 'env' };
  }
  return {
    configured: false,
    accountId: dbAccount || envAccount || '',
    hasToken: !!(dbToken || envToken),
    source: null
  };
}

export async function getGoogleAdsConfigForUi(): Promise<GoogleAdsConfigUi> {
  const row = await readIntegration('google_ads');
  const envRefresh = process.env.GOOGLE_ADS_REFRESH_TOKEN?.trim();
  const envDev = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
  const envCustomer = process.env.GOOGLE_ADS_CUSTOMER_ID?.trim();
  const envLogin = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.trim();
  const hasClientCredentials = !!(
    process.env.GOOGLE_ADS_CLIENT_ID?.trim() && process.env.GOOGLE_ADS_CLIENT_SECRET?.trim()
  );

  const dbRefresh = row?.refresh_token?.trim();
  const dbDev = row?.access_token?.trim();
  const dbCustomer = row?.user_id?.trim();
  const dbLogin = row?.store_id?.trim();

  const refreshToken = dbRefresh || envRefresh;
  const developerToken = dbDev || envDev;
  const customerId = dbCustomer || envCustomer || '';
  const loginCustomerId = dbLogin || envLogin || '';

  const configured = !!(
    refreshToken &&
    developerToken &&
    customerId &&
    hasClientCredentials
  );

  let source: 'db' | 'env' | null = null;
  if (configured) {
    source = dbRefresh && dbCustomer ? 'db' : 'env';
  }

  return {
    configured,
    customerId,
    loginCustomerId,
    hasRefreshToken: !!refreshToken,
    hasDeveloperToken: !!developerToken,
    hasClientCredentials,
    source
  };
}

export async function saveMetaAdsConfig(params: {
  accountId: string;
  accessToken?: string;
  keepExistingToken?: boolean;
}): Promise<void> {
  const accountId = String(params.accountId || '').trim().replace(/^act_/i, '');
  if (!accountId) throw new Error('ID de cuenta publicitaria requerido');

  const existing = await readIntegration('meta_ads');
  let token = params.accessToken?.trim();
  if (!token && params.keepExistingToken) {
    token = existing?.access_token?.trim() || process.env.META_ADS_ACCESS_TOKEN?.trim();
  }
  if (!token) throw new Error('Token de acceso de Meta requerido');

  await execute(
    `INSERT INTO integrations (platform, access_token, user_id)
     VALUES ('meta_ads', ?, ?)
     ON DUPLICATE KEY UPDATE
       access_token = VALUES(access_token),
       user_id = VALUES(user_id),
       updated_at = CURRENT_TIMESTAMP`,
    [token, accountId]
  );
}

export async function saveGoogleAdsConfig(params: {
  customerId: string;
  loginCustomerId?: string;
  developerToken?: string;
  refreshToken?: string;
  keepExistingDeveloperToken?: boolean;
  keepExistingRefreshToken?: boolean;
}): Promise<void> {
  const customerId = String(params.customerId || '').trim().replace(/-/g, '');
  if (!customerId) throw new Error('Customer ID de Google Ads requerido');

  const existing = await readIntegration('google_ads');
  let developerToken = params.developerToken?.trim();
  if (!developerToken && params.keepExistingDeveloperToken) {
    developerToken =
      existing?.access_token?.trim() || process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
  }
  if (!developerToken) throw new Error('Developer token de Google Ads requerido');

  let refreshToken = params.refreshToken?.trim();
  if (!refreshToken && params.keepExistingRefreshToken) {
    refreshToken =
      existing?.refresh_token?.trim() || process.env.GOOGLE_ADS_REFRESH_TOKEN?.trim();
  }
  if (!refreshToken) throw new Error('Refresh token de Google Ads requerido');

  if (!process.env.GOOGLE_ADS_CLIENT_ID?.trim() || !process.env.GOOGLE_ADS_CLIENT_SECRET?.trim()) {
    throw new Error('Configurá GOOGLE_ADS_CLIENT_ID y GOOGLE_ADS_CLIENT_SECRET en el servidor (.env)');
  }

  const loginCustomerId = params.loginCustomerId?.trim().replace(/-/g, '') || null;

  await execute(
    `INSERT INTO integrations (platform, access_token, refresh_token, user_id, store_id)
     VALUES ('google_ads', ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       access_token = VALUES(access_token),
       refresh_token = VALUES(refresh_token),
       user_id = VALUES(user_id),
       store_id = VALUES(store_id),
       updated_at = CURRENT_TIMESTAMP`,
    [developerToken, refreshToken, customerId, loginCustomerId]
  );
}

export async function disconnectMetaAds(): Promise<void> {
  await execute('DELETE FROM integrations WHERE platform = ?', ['meta_ads']);
}

export async function disconnectGoogleAds(): Promise<void> {
  await execute('DELETE FROM integrations WHERE platform = ?', ['google_ads']);
}
