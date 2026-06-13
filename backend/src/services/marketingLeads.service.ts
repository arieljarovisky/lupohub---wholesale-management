import { v4 as uuidv4 } from 'uuid';
import { query, execute, get } from '../database/db';
import {
  isLeadSource,
  isLeadStage,
  LEAD_STAGES,
  type LeadSource,
  type LeadStage
} from '../types/marketingLeads';
import { fetchMetaAdsCampaigns } from './metaAds.service';
import { fetchGoogleAdsCampaigns } from './googleAds.service';

export type MarketingLeadRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  source: LeadSource;
  stage: LeadStage;
  campaignId: string | null;
  campaignName: string | null;
  revenue: number | null;
  notes: string | null;
  enteredAt: string;
  contactedAt: string | null;
  quotedAt: string | null;
  closedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  externalId: string | null;
  externalProvider: string | null;
};

function mapRow(r: any): MarketingLeadRow {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone ?? null,
    email: r.email ?? null,
    source: r.source,
    stage: r.stage,
    campaignId: r.campaign_id ?? null,
    campaignName: r.campaign_name ?? null,
    revenue: r.revenue != null ? Number(r.revenue) : null,
    notes: r.notes ?? null,
    enteredAt: r.entered_at,
    contactedAt: r.contacted_at ?? null,
    quotedAt: r.quoted_at ?? null,
    closedAt: r.closed_at ?? null,
    createdBy: r.created_by ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    externalId: r.external_id ?? null,
    externalProvider: r.external_provider ?? null
  };
}

function stageTimestampField(stage: LeadStage): string | null {
  if (stage === 'CONTACTED') return 'contacted_at';
  if (stage === 'QUOTED') return 'quoted_at';
  if (stage === 'SALE_CLOSED') return 'closed_at';
  return null;
}

async function fetchAdSpendMap(
  dateFrom: string,
  dateTo: string
): Promise<Map<string, { spend: number; name: string; source: LeadSource }>> {
  const map = new Map<string, { spend: number; name: string; source: LeadSource }>();

  try {
    const meta = await fetchMetaAdsCampaigns(dateFrom, dateTo);
    for (const c of meta.campaigns) {
      map.set(`meta:${c.id}`, { spend: c.spend, name: c.name, source: 'FACEBOOK_ADS' });
      if (c.name) map.set(`meta_name:${c.name.toLowerCase()}`, { spend: c.spend, name: c.name, source: 'FACEBOOK_ADS' });
    }
  } catch {
    /* sin meta configurado */
  }

  try {
    const google = await fetchGoogleAdsCampaigns(dateFrom, dateTo);
    for (const c of google.campaigns) {
      map.set(`google:${c.id}`, { spend: c.cost, name: c.name, source: 'GOOGLE_ADS' });
      if (c.name) map.set(`google_name:${c.name.toLowerCase()}`, { spend: c.cost, name: c.name, source: 'GOOGLE_ADS' });
    }
  } catch {
    /* sin google configurado */
  }

  return map;
}

function resolveSpend(
  spendMap: Map<string, { spend: number; name: string; source: LeadSource }>,
  source: LeadSource,
  campaignId: string | null,
  campaignName: string | null
): number {
  if (campaignId) {
    const prefix = source === 'GOOGLE_ADS' ? 'google' : 'meta';
    const hit = spendMap.get(`${prefix}:${campaignId}`);
    if (hit) return hit.spend;
  }
  if (campaignName) {
    const prefix = source === 'GOOGLE_ADS' ? 'google_name' : 'meta_name';
    const hit = spendMap.get(`${prefix}:${campaignName.toLowerCase()}`);
    if (hit) return hit.spend;
  }
  if (source === 'INSTAGRAM') {
    if (campaignId) {
      const hit = spendMap.get(`meta:${campaignId}`);
      if (hit) return hit.spend;
    }
    if (campaignName) {
      const hit = spendMap.get(`meta_name:${campaignName.toLowerCase()}`);
      if (hit) return hit.spend;
    }
  }
  return 0;
}

export async function listMarketingLeads(params: {
  dateFrom?: string;
  dateTo?: string;
  source?: string;
  stage?: string;
  campaignId?: string;
}): Promise<MarketingLeadRow[]> {
  const where: string[] = [];
  const args: unknown[] = [];

  if (params.dateFrom) {
    where.push('entered_at >= ?');
    args.push(`${params.dateFrom} 00:00:00`);
  }
  if (params.dateTo) {
    where.push('entered_at <= ?');
    args.push(`${params.dateTo} 23:59:59`);
  }
  if (params.source && isLeadSource(params.source)) {
    where.push('source = ?');
    args.push(params.source);
  }
  if (params.stage && isLeadStage(params.stage)) {
    where.push('stage = ?');
    args.push(params.stage);
  }
  if (params.campaignId) {
    where.push('campaign_id = ?');
    args.push(params.campaignId);
  }

  const sql = `
    SELECT id, name, phone, email, source, stage, campaign_id, campaign_name, revenue, notes,
           entered_at, contacted_at, quoted_at, closed_at, created_by, created_at, updated_at,
           external_id, external_provider
    FROM marketing_leads
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY entered_at DESC
  `;
  const rows = await query(sql, args);
  return rows.map(mapRow);
}

export async function createMarketingLead(input: {
  name: string;
  phone?: string;
  email?: string;
  source: string;
  campaignId?: string;
  campaignName?: string;
  notes?: string;
  createdBy?: string;
}): Promise<MarketingLeadRow> {
  if (!input.name?.trim()) throw new Error('Nombre requerido');
  if (!isLeadSource(input.source)) throw new Error('Origen de lead inválido');

  const id = uuidv4();
  await execute(
    `INSERT INTO marketing_leads
      (id, name, phone, email, source, stage, campaign_id, campaign_name, notes, created_by, entered_at)
     VALUES (?, ?, ?, ?, ?, 'LEAD_ENTERED', ?, ?, ?, ?, NOW())`,
    [
      id,
      input.name.trim(),
      input.phone?.trim() || null,
      input.email?.trim() || null,
      input.source,
      input.campaignId?.trim() || null,
      input.campaignName?.trim() || null,
      input.notes?.trim() || null,
      input.createdBy || null
    ]
  );
  const row = await get('SELECT * FROM marketing_leads WHERE id = ?', [id]);
  return mapRow(row);
}

export async function createMarketingLeadFromWebhook(input: {
  name: string;
  phone?: string;
  email?: string;
  source: string;
  campaignId?: string;
  campaignName?: string;
  notes?: string;
  externalId?: string;
  externalProvider?: string;
}): Promise<{ lead: MarketingLeadRow; created: boolean }> {
  const provider = input.externalProvider?.trim() || 'generic';
  const externalId = input.externalId?.trim();

  if (externalId) {
    const existing = await get(
      'SELECT * FROM marketing_leads WHERE external_provider = ? AND external_id = ? LIMIT 1',
      [provider, externalId]
    );
    if (existing) {
      if (provider === 'whatsapp' && input.notes?.trim()) {
        const prev = existing.notes ? String(existing.notes) : '';
        const stamp = new Date().toLocaleString('es-AR');
        const merged = prev ? `${prev}\n---\n[${stamp}] ${input.notes.trim()}` : `[${stamp}] ${input.notes.trim()}`;
        await execute('UPDATE marketing_leads SET notes = ? WHERE id = ?', [merged, existing.id]);
        const row = await get('SELECT * FROM marketing_leads WHERE id = ?', [existing.id]);
        return { lead: mapRow(row), created: false };
      }
      return { lead: mapRow(existing), created: false };
    }
  }

  if (!input.name?.trim()) throw new Error('Nombre requerido');
  if (!isLeadSource(input.source)) throw new Error('Origen de lead inválido');

  const id = uuidv4();
  await execute(
    `INSERT INTO marketing_leads
      (id, name, phone, email, source, stage, campaign_id, campaign_name, notes,
       external_id, external_provider, entered_at)
     VALUES (?, ?, ?, ?, ?, 'LEAD_ENTERED', ?, ?, ?, ?, ?, NOW())`,
    [
      id,
      input.name.trim(),
      input.phone?.trim() || null,
      input.email?.trim() || null,
      input.source,
      input.campaignId?.trim() || null,
      input.campaignName?.trim() || null,
      input.notes?.trim() || null,
      externalId || null,
      externalId ? provider : null
    ]
  );
  const row = await get('SELECT * FROM marketing_leads WHERE id = ?', [id]);
  return { lead: mapRow(row), created: true };
}

export async function updateMarketingLead(
  id: string,
  input: {
    name?: string;
    phone?: string | null;
    email?: string | null;
    source?: string;
    stage?: string;
    campaignId?: string | null;
    campaignName?: string | null;
    revenue?: number | null;
    notes?: string | null;
  }
): Promise<MarketingLeadRow> {
  const existing = await get('SELECT * FROM marketing_leads WHERE id = ?', [id]);
  if (!existing) throw new Error('Lead no encontrado');

  const sets: string[] = [];
  const args: unknown[] = [];

  if (input.name != null) {
    sets.push('name = ?');
    args.push(input.name.trim());
  }
  if (input.phone !== undefined) {
    sets.push('phone = ?');
    args.push(input.phone?.trim() || null);
  }
  if (input.email !== undefined) {
    sets.push('email = ?');
    args.push(input.email?.trim() || null);
  }
  if (input.source != null) {
    if (!isLeadSource(input.source)) throw new Error('Origen inválido');
    sets.push('source = ?');
    args.push(input.source);
  }
  if (input.campaignId !== undefined) {
    sets.push('campaign_id = ?');
    args.push(input.campaignId?.trim() || null);
  }
  if (input.campaignName !== undefined) {
    sets.push('campaign_name = ?');
    args.push(input.campaignName?.trim() || null);
  }
  if (input.notes !== undefined) {
    sets.push('notes = ?');
    args.push(input.notes?.trim() || null);
  }
  if (input.revenue !== undefined) {
    sets.push('revenue = ?');
    args.push(input.revenue != null && Number.isFinite(input.revenue) ? input.revenue : null);
  }
  if (input.stage != null) {
    if (!isLeadStage(input.stage)) throw new Error('Etapa inválida');
    sets.push('stage = ?');
    args.push(input.stage);
    const tsField = stageTimestampField(input.stage);
    if (tsField) {
      sets.push(`${tsField} = COALESCE(${tsField}, NOW())`);
    }
  }

  if (sets.length === 0) throw new Error('Sin cambios');

  args.push(id);
  await execute(`UPDATE marketing_leads SET ${sets.join(', ')} WHERE id = ?`, args);
  const row = await get('SELECT * FROM marketing_leads WHERE id = ?', [id]);
  return mapRow(row);
}

export async function deleteMarketingLead(id: string): Promise<void> {
  const r = await execute('DELETE FROM marketing_leads WHERE id = ?', [id]);
  if ((r as any)?.affectedRows === 0) throw new Error('Lead no encontrado');
}

export async function getMarketingLeadMetrics(params: {
  dateFrom: string;
  dateTo: string;
}): Promise<{
  funnel: Record<LeadStage, number>;
  bySource: Array<{
    source: LeadSource;
    leads: number;
    contacted: number;
    quoted: number;
    sales: number;
    revenue: number;
    conversionRate: number;
  }>;
  byCampaign: Array<{
    key: string;
    source: LeadSource;
    campaignId: string | null;
    campaignName: string | null;
    leads: number;
    sales: number;
    revenue: number;
    spend: number;
    conversionRate: number;
    cpa: number;
    roas: number;
  }>;
  totals: {
    leads: number;
    sales: number;
    revenue: number;
    spend: number;
    conversionRate: number;
    cpa: number;
    roas: number;
  };
}> {
  const leads = await listMarketingLeads({ dateFrom: params.dateFrom, dateTo: params.dateTo });
  const spendMap = await fetchAdSpendMap(params.dateFrom, params.dateTo);

  const funnel = LEAD_STAGES.reduce(
    (acc, s) => {
      acc[s] = 0;
      return acc;
    },
    {} as Record<LeadStage, number>
  );
  funnel.LEAD_ENTERED = leads.length;
  funnel.CONTACTED = leads.filter(
    (l) => l.stage === 'CONTACTED' || l.stage === 'QUOTED' || l.stage === 'SALE_CLOSED'
  ).length;
  funnel.QUOTED = leads.filter((l) => l.stage === 'QUOTED' || l.stage === 'SALE_CLOSED').length;
  funnel.SALE_CLOSED = leads.filter((l) => l.stage === 'SALE_CLOSED').length;

  const bySourceMap = new Map<
    LeadSource,
    { leads: number; contacted: number; quoted: number; sales: number; revenue: number }
  >();
  for (const l of leads) {
    const cur = bySourceMap.get(l.source) || { leads: 0, contacted: 0, quoted: 0, sales: 0, revenue: 0 };
    cur.leads += 1;
    if (l.stage === 'CONTACTED' || l.stage === 'QUOTED' || l.stage === 'SALE_CLOSED') cur.contacted += 1;
    if (l.stage === 'QUOTED' || l.stage === 'SALE_CLOSED') cur.quoted += 1;
    if (l.stage === 'SALE_CLOSED') {
      cur.sales += 1;
      cur.revenue += l.revenue || 0;
    }
    bySourceMap.set(l.source, cur);
  }

  const bySource = Array.from(bySourceMap.entries()).map(([source, v]) => ({
    source,
    ...v,
    conversionRate: v.leads > 0 ? (v.sales / v.leads) * 100 : 0
  }));

  const campaignMap = new Map<
    string,
    {
      source: LeadSource;
      campaignId: string | null;
      campaignName: string | null;
      leads: number;
      sales: number;
      revenue: number;
    }
  >();

  for (const l of leads) {
    const key = `${l.source}::${l.campaignId || ''}::${(l.campaignName || '').toLowerCase()}`;
    const cur = campaignMap.get(key) || {
      source: l.source,
      campaignId: l.campaignId,
      campaignName: l.campaignName,
      leads: 0,
      sales: 0,
      revenue: 0
    };
    cur.leads += 1;
    if (l.stage === 'SALE_CLOSED') {
      cur.sales += 1;
      cur.revenue += l.revenue || 0;
    }
    campaignMap.set(key, cur);
  }

  const usedSpendKeys = new Set<string>();
  const byCampaign = Array.from(campaignMap.entries()).map(([key, v]) => {
    const spend = resolveSpend(spendMap, v.source, v.campaignId, v.campaignName);
    if (v.campaignId) usedSpendKeys.add(`${v.source === 'GOOGLE_ADS' ? 'google' : 'meta'}:${v.campaignId}`);
    return {
      key,
      source: v.source,
      campaignId: v.campaignId,
      campaignName: v.campaignName,
      leads: v.leads,
      sales: v.sales,
      revenue: v.revenue,
      spend,
      conversionRate: v.leads > 0 ? (v.sales / v.leads) * 100 : 0,
      cpa: v.sales > 0 && spend > 0 ? spend / v.sales : 0,
      roas: spend > 0 && v.revenue > 0 ? v.revenue / spend : 0
    };
  });

  byCampaign.sort((a, b) => b.leads - a.leads);

  const totalLeads = leads.length;
  const totalSales = leads.filter((l) => l.stage === 'SALE_CLOSED').length;
  const totalRevenue = leads.reduce((s, l) => s + (l.stage === 'SALE_CLOSED' ? l.revenue || 0 : 0), 0);

  let totalSpend = 0;
  for (const row of byCampaign) totalSpend += row.spend;
  for (const [k, v] of spendMap) {
    if (!k.includes('_name:')) continue;
    const already = byCampaign.some(
      (c) => c.campaignName?.toLowerCase() === v.name.toLowerCase() && c.source === v.source
    );
    if (!already) totalSpend += v.spend;
  }

  return {
    funnel,
    bySource,
    byCampaign,
    totals: {
      leads: totalLeads,
      sales: totalSales,
      revenue: totalRevenue,
      spend: totalSpend,
      conversionRate: totalLeads > 0 ? (totalSales / totalLeads) * 100 : 0,
      cpa: totalSales > 0 && totalSpend > 0 ? totalSpend / totalSales : 0,
      roas: totalSpend > 0 && totalRevenue > 0 ? totalRevenue / totalSpend : 0
    }
  };
}
