import axios from 'axios';
import { getGoogleAdsConfig } from './adsIntegrations.service';

const API_VERSION = 'v18';

export type GoogleCampaignRow = {
  id: string;
  name: string;
  status: string;
  channelType: string;
  impressions: number;
  clicks: number;
  cost: number;
  ctr: number;
  cpc: number;
  conversions: number;
};

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function statusLabel(code: unknown): string {
  const n = toNum(code);
  const map: Record<number, string> = {
    0: 'UNSPECIFIED',
    1: 'UNKNOWN',
    2: 'ENABLED',
    3: 'PAUSED',
    4: 'REMOVED'
  };
  return map[n] || String(code ?? '—');
}

function channelLabel(code: unknown): string {
  const n = toNum(code);
  const map: Record<number, string> = {
    0: 'UNSPECIFIED',
    1: 'UNKNOWN',
    2: 'SEARCH',
    3: 'DISPLAY',
    4: 'SHOPPING',
    5: 'HOTEL',
    6: 'VIDEO',
    7: 'MULTI_CHANNEL',
    8: 'LOCAL',
    9: 'SMART',
    10: 'PERFORMANCE_MAX',
    11: 'LOCAL_SERVICES',
    12: 'DISCOVERY',
    13: 'TRAVEL',
    14: 'DEMAND_GEN'
  };
  return map[n] || String(code ?? '—');
}

async function getGoogleAccessToken(config: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<string> {
  const r = await axios.post(
    'https://oauth2.googleapis.com/token',
    {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: 'refresh_token'
    },
    { validateStatus: () => true }
  );
  if (r.status !== 200 || !r.data?.access_token) {
    const detail = r.data?.error_description || r.data?.error || r.statusText;
    throw new Error(`Error OAuth Google: ${detail}`);
  }
  return String(r.data.access_token);
}

export async function fetchGoogleAdsCampaigns(
  dateFrom: string,
  dateTo: string
): Promise<{ campaigns: GoogleCampaignRow[]; summary: Record<string, number> }> {
  const config = await getGoogleAdsConfig();
  if (!config) {
    throw Object.assign(new Error('Google Ads no configurado'), { code: 'NOT_CONFIGURED' });
  }

  const accessToken = await getGoogleAccessToken(config);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': config.developerToken,
    'Content-Type': 'application/json'
  };
  if (config.loginCustomerId) {
    headers['login-customer-id'] = config.loginCustomerId;
  }

  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions
    FROM campaign
    WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
    ORDER BY metrics.cost_micros DESC
  `.trim();

  const r = await axios.post(
    `https://googleads.googleapis.com/${API_VERSION}/customers/${config.customerId}/googleAds:search`,
    { query },
    { headers, validateStatus: () => true }
  );

  if (r.status !== 200) {
    const detail =
      r.data?.error?.message ||
      (Array.isArray(r.data) ? r.data[0]?.error?.message : null) ||
      r.statusText;
    throw new Error(`Error Google Ads: ${detail}`);
  }

  const results = Array.isArray(r.data?.results) ? r.data.results : [];
  const byId = new Map<string, GoogleCampaignRow>();

  for (const row of results) {
    const campaign = row.campaign || {};
    const metrics = row.metrics || {};
    const id = String(campaign.id || '');
    if (!id) continue;

    const impressions = toNum(metrics.impressions);
    const clicks = toNum(metrics.clicks);
    const costMicros = toNum(metrics.costMicros ?? metrics.cost_micros);
    const cost = costMicros / 1_000_000;
    const conversions = toNum(metrics.conversions);

    const existing = byId.get(id);
    if (existing) {
      existing.impressions += impressions;
      existing.clicks += clicks;
      existing.cost += cost;
      existing.conversions += conversions;
      existing.ctr = existing.impressions > 0 ? (existing.clicks / existing.impressions) * 100 : 0;
      existing.cpc = existing.clicks > 0 ? existing.cost / existing.clicks : 0;
    } else {
      byId.set(id, {
        id,
        name: String(campaign.name || '—'),
        status: statusLabel(campaign.status),
        channelType: channelLabel(campaign.advertisingChannelType ?? campaign.advertising_channel_type),
        impressions,
        clicks,
        cost,
        ctr: toNum(metrics.ctr) * 100 || (impressions > 0 ? (clicks / impressions) * 100 : 0),
        cpc: toNum(metrics.averageCpc ?? metrics.average_cpc) / 1_000_000 || (clicks > 0 ? cost / clicks : 0),
        conversions
      });
    }
  }

  const campaigns = Array.from(byId.values()).sort((a, b) => b.cost - a.cost);

  const summary = campaigns.reduce(
    (acc, c) => {
      acc.impressions += c.impressions;
      acc.clicks += c.clicks;
      acc.cost += c.cost;
      acc.conversions += c.conversions;
      return acc;
    },
    { impressions: 0, clicks: 0, cost: 0, conversions: 0, ctr: 0, cpc: 0 }
  );
  summary.ctr = summary.impressions > 0 ? (summary.clicks / summary.impressions) * 100 : 0;
  summary.cpc = summary.clicks > 0 ? summary.cost / summary.clicks : 0;

  return { campaigns, summary };
}
