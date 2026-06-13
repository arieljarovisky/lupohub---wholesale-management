import axios from 'axios';
import { getMetaAdsConfig } from './adsIntegrations.service';

const GRAPH_VERSION = 'v21.0';

export type MetaCampaignRow = {
  id: string;
  name: string;
  status: string;
  objective: string;
  dailyBudget: number | null;
  impressions: number;
  clicks: number;
  spend: number;
  cpc: number;
  ctr: number;
  reach: number;
  conversions: number;
};

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseConversions(actions: unknown): number {
  if (!Array.isArray(actions)) return 0;
  const purchase = actions.find(
    (a: any) =>
      a?.action_type === 'purchase' ||
      a?.action_type === 'omni_purchase' ||
      a?.action_type === 'offsite_conversion.fb_pixel_purchase'
  );
  return toNum(purchase?.value);
}

export async function fetchMetaAdsCampaigns(
  dateFrom: string,
  dateTo: string
): Promise<{ campaigns: MetaCampaignRow[]; summary: Record<string, number> }> {
  const config = await getMetaAdsConfig();
  if (!config) {
    throw Object.assign(new Error('Meta Ads no configurado'), { code: 'NOT_CONFIGURED' });
  }

  const accountId = config.accountId.replace(/^act_/i, '');
  const base = `https://graph.facebook.com/${GRAPH_VERSION}/act_${accountId}`;
  const timeRange = JSON.stringify({ since: dateFrom, until: dateTo });

  const [campaignsRes, insightsRes] = await Promise.all([
    axios.get(`${base}/campaigns`, {
      params: {
        fields: 'id,name,status,objective,daily_budget,effective_status',
        limit: 200,
        access_token: config.accessToken
      },
      validateStatus: () => true
    }),
    axios.get(`${base}/insights`, {
      params: {
        level: 'campaign',
        fields: 'campaign_id,campaign_name,impressions,clicks,spend,cpc,ctr,reach,actions',
        time_range: timeRange,
        limit: 500,
        access_token: config.accessToken
      },
      validateStatus: () => true
    })
  ]);

  if (campaignsRes.status !== 200) {
    const detail =
      campaignsRes.data?.error?.message || campaignsRes.data?.error?.error_user_msg || campaignsRes.statusText;
    throw new Error(`Error Meta Ads (campañas): ${detail}`);
  }
  if (insightsRes.status !== 200) {
    const detail =
      insightsRes.data?.error?.message || insightsRes.data?.error?.error_user_msg || insightsRes.statusText;
    throw new Error(`Error Meta Ads (métricas): ${detail}`);
  }

  const campaignsList = Array.isArray(campaignsRes.data?.data) ? campaignsRes.data.data : [];
  const insightsList = Array.isArray(insightsRes.data?.data) ? insightsRes.data.data : [];

  const insightsById = new Map<string, any>();
  for (const row of insightsList) {
    const id = String(row.campaign_id || '');
    if (id) insightsById.set(id, row);
  }

  const campaigns: MetaCampaignRow[] = campaignsList.map((c: any) => {
    const ins = insightsById.get(String(c.id)) || {};
    const spend = toNum(ins.spend);
    const clicks = toNum(ins.clicks);
    const impressions = toNum(ins.impressions);
    return {
      id: String(c.id),
      name: String(c.name || ins.campaign_name || '—'),
      status: String(c.effective_status || c.status || '—'),
      objective: String(c.objective || '—'),
      dailyBudget: c.daily_budget != null ? toNum(c.daily_budget) / 100 : null,
      impressions,
      clicks,
      spend,
      cpc: clicks > 0 ? spend / clicks : toNum(ins.cpc),
      ctr: impressions > 0 ? (clicks / impressions) * 100 : toNum(ins.ctr),
      reach: toNum(ins.reach),
      conversions: parseConversions(ins.actions)
    };
  });

  campaigns.sort((a, b) => b.spend - a.spend);

  const summary = campaigns.reduce(
    (acc, c) => {
      acc.impressions += c.impressions;
      acc.clicks += c.clicks;
      acc.spend += c.spend;
      acc.reach += c.reach;
      acc.conversions += c.conversions;
      return acc;
    },
    { impressions: 0, clicks: 0, spend: 0, reach: 0, conversions: 0, ctr: 0, cpc: 0 }
  );
  summary.ctr = summary.impressions > 0 ? (summary.clicks / summary.impressions) * 100 : 0;
  summary.cpc = summary.clicks > 0 ? summary.spend / summary.clicks : 0;

  return { campaigns, summary };
}
