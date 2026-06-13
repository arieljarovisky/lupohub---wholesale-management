import axios from 'axios';
import { getMetaAdsConfig } from './adsIntegrations.service';

const GRAPH_VERSION = 'v21.0';

const INSIGHTS_METRIC_FIELDS =
  'impressions,clicks,spend,cpc,ctr,reach,frequency,actions,action_values,purchase_roas,cost_per_action_type';

const PURCHASE_ACTION_TYPES = new Set([
  'purchase',
  'omni_purchase',
  'offsite_conversion.fb_pixel_purchase',
  'onsite_conversion.purchase'
]);

export type MetaMetricsRow = {
  id: string;
  name: string;
  status: string;
  objective?: string;
  dailyBudget: number | null;
  impressions: number;
  clicks: number;
  spend: number;
  cpc: number;
  ctr: number;
  reach: number;
  frequency: number;
  conversions: number;
  purchaseValue: number;
  roas: number;
  cpa: number;
};

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pickActionValue(actions: unknown, types: Set<string>): number {
  if (!Array.isArray(actions)) return 0;
  let total = 0;
  for (const a of actions) {
    const t = String(a?.action_type || '');
    if (types.has(t)) total += toNum(a?.value);
  }
  return total;
}

function pickActionValues(actionValues: unknown, types: Set<string>): number {
  if (!Array.isArray(actionValues)) return 0;
  let total = 0;
  for (const a of actionValues) {
    const t = String(a?.action_type || '');
    if (types.has(t)) total += toNum(a?.value);
  }
  return total;
}

function pickPurchaseRoas(purchaseRoas: unknown): number {
  if (!Array.isArray(purchaseRoas)) return 0;
  const row = purchaseRoas.find((a: any) =>
    PURCHASE_ACTION_TYPES.has(String(a?.action_type || ''))
  );
  return toNum(row?.value);
}

function pickCpa(costPerAction: unknown): number {
  if (!Array.isArray(costPerAction)) return 0;
  const row = costPerAction.find((a: any) =>
    PURCHASE_ACTION_TYPES.has(String(a?.action_type || ''))
  );
  return toNum(row?.value);
}

function mapInsightsRow(ins: any, fallbackName = '—'): Omit<MetaMetricsRow, 'status' | 'objective' | 'dailyBudget'> {
  const spend = toNum(ins.spend);
  const clicks = toNum(ins.clicks);
  const impressions = toNum(ins.impressions);
  const conversions = pickActionValue(ins.actions, PURCHASE_ACTION_TYPES);
  const purchaseValue = pickActionValues(ins.action_values, PURCHASE_ACTION_TYPES);
  const roasApi = pickPurchaseRoas(ins.purchase_roas);
  const cpaApi = pickCpa(ins.cost_per_action_type);
  const roas = roasApi > 0 ? roasApi : spend > 0 && purchaseValue > 0 ? purchaseValue / spend : 0;
  const cpa = cpaApi > 0 ? cpaApi : conversions > 0 ? spend / conversions : 0;

  return {
    id: String(ins.campaign_id || ins.adset_id || ins.ad_id || ''),
    name: String(ins.campaign_name || ins.adset_name || ins.ad_name || fallbackName),
    impressions,
    clicks,
    spend,
    cpc: clicks > 0 ? spend / clicks : toNum(ins.cpc),
    ctr: impressions > 0 ? (clicks / impressions) * 100 : toNum(ins.ctr),
    reach: toNum(ins.reach),
    frequency: toNum(ins.frequency),
    conversions,
    purchaseValue,
    roas,
    cpa
  };
}

function buildSummary(rows: MetaMetricsRow[]): Record<string, number> {
  const summary = rows.reduce(
    (acc, c) => {
      acc.impressions += c.impressions;
      acc.clicks += c.clicks;
      acc.spend += c.spend;
      acc.reach += c.reach;
      acc.conversions += c.conversions;
      acc.purchaseValue += c.purchaseValue;
      return acc;
    },
    {
      impressions: 0,
      clicks: 0,
      spend: 0,
      reach: 0,
      conversions: 0,
      purchaseValue: 0,
      ctr: 0,
      cpc: 0,
      roas: 0,
      cpa: 0,
      frequency: 0
    }
  );
  summary.ctr = summary.impressions > 0 ? (summary.clicks / summary.impressions) * 100 : 0;
  summary.cpc = summary.clicks > 0 ? summary.spend / summary.clicks : 0;
  summary.roas = summary.spend > 0 && summary.purchaseValue > 0 ? summary.purchaseValue / summary.spend : 0;
  summary.cpa = summary.conversions > 0 ? summary.spend / summary.conversions : 0;
  const freqRows = rows.filter((r) => r.frequency > 0);
  summary.frequency =
    freqRows.length > 0 ? freqRows.reduce((s, r) => s + r.frequency, 0) / freqRows.length : 0;
  return summary;
}

async function metaApiContext() {
  const config = await getMetaAdsConfig();
  if (!config) {
    throw Object.assign(new Error('Meta Ads no configurado'), { code: 'NOT_CONFIGURED' });
  }
  const accountId = config.accountId.replace(/^act_/i, '');
  return {
    config,
    accountId,
    base: `https://graph.facebook.com/${GRAPH_VERSION}/act_${accountId}`,
    token: config.accessToken,
    timeRange: (from: string, to: string) => JSON.stringify({ since: from, until: to })
  };
}

async function graphGet(url: string, token: string, params: Record<string, string | number>) {
  const r = await axios.get(url, {
    params: { ...params, access_token: token },
    validateStatus: () => true
  });
  if (r.status !== 200) {
    const detail = r.data?.error?.message || r.data?.error?.error_user_msg || r.statusText;
    throw new Error(detail || 'Error Meta Graph API');
  }
  return r.data;
}

function mergeEntityInsights(
  entities: any[],
  insightsList: any[],
  idKey: 'campaign_id' | 'adset_id' | 'ad_id',
  nameKey: 'campaign_name' | 'adset_name' | 'ad_name',
  extra: (entity: any) => Partial<MetaMetricsRow>
): MetaMetricsRow[] {
  const insightsById = new Map<string, any>();
  for (const row of insightsList) {
    const id = String(row[idKey] || '');
    if (id) insightsById.set(id, row);
  }

  return entities.map((entity) => {
    const id = String(entity.id);
    const ins = insightsById.get(id) || {};
    const metrics = mapInsightsRow(
      { ...ins, [idKey]: id, [nameKey]: entity.name },
      String(entity.name || '—')
    );
    return {
      ...metrics,
      id,
      name: String(entity.name || metrics.name),
      status: String(entity.effective_status || entity.status || '—'),
      dailyBudget:
        entity.daily_budget != null
          ? toNum(entity.daily_budget) / 100
          : entity.lifetime_budget != null
            ? toNum(entity.lifetime_budget) / 100
            : null,
      ...extra(entity)
    };
  });
}

export async function fetchMetaAdsCampaigns(
  dateFrom: string,
  dateTo: string
): Promise<{ accountId: string; campaigns: MetaMetricsRow[]; summary: Record<string, number> }> {
  const ctx = await metaApiContext();

  const [campaignsData, insightsData] = await Promise.all([
    graphGet(`${ctx.base}/campaigns`, ctx.token, {
      fields: 'id,name,status,objective,daily_budget,effective_status',
      limit: 200
    }),
    graphGet(`${ctx.base}/insights`, ctx.token, {
      level: 'campaign',
      fields: `campaign_id,campaign_name,${INSIGHTS_METRIC_FIELDS}`,
      time_range: ctx.timeRange(dateFrom, dateTo),
      limit: 500
    })
  ]);

  const campaignsList = Array.isArray(campaignsData?.data) ? campaignsData.data : [];
  const insightsList = Array.isArray(insightsData?.data) ? insightsData.data : [];

  const campaigns = mergeEntityInsights(campaignsList, insightsList, 'campaign_id', 'campaign_name', (c) => ({
    objective: String(c.objective || '—')
  }));

  campaigns.sort((a, b) => b.spend - a.spend);

  return { accountId: ctx.accountId, campaigns, summary: buildSummary(campaigns) };
}

export async function fetchMetaAdSets(
  campaignId: string,
  dateFrom: string,
  dateTo: string
): Promise<{ adsets: MetaMetricsRow[]; summary: Record<string, number> }> {
  const ctx = await metaApiContext();
  const cid = String(campaignId || '').trim();
  if (!cid) throw new Error('campaign_id requerido');

  const [adsetsData, insightsData] = await Promise.all([
    graphGet(`https://graph.facebook.com/${GRAPH_VERSION}/${cid}/adsets`, ctx.token, {
      fields: 'id,name,status,effective_status,daily_budget,lifetime_budget',
      limit: 200
    }),
    graphGet(`https://graph.facebook.com/${GRAPH_VERSION}/${cid}/insights`, ctx.token, {
      level: 'adset',
      fields: `adset_id,adset_name,${INSIGHTS_METRIC_FIELDS}`,
      time_range: ctx.timeRange(dateFrom, dateTo),
      limit: 500
    })
  ]);

  const adsetsList = Array.isArray(adsetsData?.data) ? adsetsData.data : [];
  const insightsList = Array.isArray(insightsData?.data) ? insightsData.data : [];

  const adsets = mergeEntityInsights(adsetsList, insightsList, 'adset_id', 'adset_name', () => ({}));
  adsets.sort((a, b) => b.spend - a.spend);

  return { adsets, summary: buildSummary(adsets) };
}

export async function fetchMetaAdsForAdSet(
  adsetId: string,
  dateFrom: string,
  dateTo: string
): Promise<{ ads: MetaMetricsRow[]; summary: Record<string, number> }> {
  const ctx = await metaApiContext();
  const aid = String(adsetId || '').trim();
  if (!aid) throw new Error('adset_id requerido');

  const [adsData, insightsData] = await Promise.all([
    graphGet(`https://graph.facebook.com/${GRAPH_VERSION}/${aid}/ads`, ctx.token, {
      fields: 'id,name,status,effective_status',
      limit: 200
    }),
    graphGet(`https://graph.facebook.com/${GRAPH_VERSION}/${aid}/insights`, ctx.token, {
      level: 'ad',
      fields: `ad_id,ad_name,${INSIGHTS_METRIC_FIELDS}`,
      time_range: ctx.timeRange(dateFrom, dateTo),
      limit: 500
    })
  ]);

  const adsList = Array.isArray(adsData?.data) ? adsData.data : [];
  const insightsList = Array.isArray(insightsData?.data) ? insightsData.data : [];

  const ads = mergeEntityInsights(adsList, insightsList, 'ad_id', 'ad_name', () => ({}));
  ads.sort((a, b) => b.spend - a.spend);

  return { ads, summary: buildSummary(ads) };
}

export function metaAdsManagerUrl(
  accountId: string,
  params: { campaignId?: string; adsetId?: string; adId?: string }
): string {
  const act = accountId.replace(/^act_/i, '');
  const q = new URLSearchParams({ act });
  if (params.campaignId) q.set('selected_campaign_ids', params.campaignId);
  if (params.adsetId) q.set('selected_adset_ids', params.adsetId);
  if (params.adId) q.set('selected_ad_ids', params.adId);
  return `https://www.facebook.com/adsmanager/manage/campaigns?${q.toString()}`;
}
