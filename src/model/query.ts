import { daysBetween } from './dates';
import type { InventoryRow, StockStatus, Warehouse, ZoneId } from './types';

export const EXPIRING_WITHIN_DAYS = 7;

/** Join inventory with SKU and bin data into flat rows, and work out each row's status. */
export function buildRows(wh: Warehouse): InventoryRow[] {
  const skuMap = new Map(wh.skus.map((s) => [s.sku, s]));
  const binMap = new Map(wh.bins.map((b) => [b.id, b]));
  const casesPerBin = new Map<string, number>();
  const casesPerSku = new Map<string, number>();
  for (const r of wh.inventory) {
    casesPerBin.set(r.binId, (casesPerBin.get(r.binId) ?? 0) + r.cases);
    casesPerSku.set(r.sku, (casesPerSku.get(r.sku) ?? 0) + r.cases);
  }
  return wh.inventory.map((r) => {
    const sku = skuMap.get(r.sku);
    const bin = binMap.get(r.binId);
    if (!sku || !bin) throw new Error(`Inventory record ${r.lot} points at a missing SKU or bin`);
    const daysToExpiry = r.bestBefore ? daysBetween(wh.asOf, r.bestBefore) : null;
    let status: StockStatus = 'ok';
    if (daysToExpiry !== null && daysToExpiry < 0) status = 'expired';
    else if (daysToExpiry !== null && daysToExpiry <= EXPIRING_WITHIN_DAYS) status = 'expiring';
    else if ((casesPerSku.get(r.sku) ?? 0) < sku.reorderPoint) status = 'low';
    return {
      key: `${r.binId}|${r.lot}`,
      sku: sku.sku,
      name: sku.name,
      category: sku.category,
      storage: sku.storage,
      zone: bin.zone,
      binId: bin.id,
      cases: r.cases,
      units: r.cases * sku.unitsPerCase,
      lot: r.lot,
      receivedOn: r.receivedOn,
      bestBefore: r.bestBefore,
      daysToExpiry,
      binFill: (casesPerBin.get(bin.id) ?? 0) / bin.capacity,
      status,
    };
  });
}

export type SortKey = 'sku' | 'name' | 'zone' | 'binId' | 'cases' | 'units' | 'bestBefore' | 'binFill' | 'status';
export type SortDir = 'asc' | 'desc';

export interface Query {
  text: string;
  zones: ZoneId[];
  statuses: StockStatus[];
  sort: SortKey;
  dir: SortDir;
  page: number;
  pageSize: number;
}

export const DEFAULT_QUERY: Query = {
  text: '', zones: [], statuses: [], sort: 'binId', dir: 'asc', page: 1, pageSize: 50,
};

const STATUS_RANK: Record<StockStatus, number> = { expired: 0, expiring: 1, low: 2, ok: 3 };

/** Case-insensitive match on every whitespace-separated term across SKU, name, bin, lot and category. */
export function matchesText(row: InventoryRow, text: string): boolean {
  const terms = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const hay = `${row.sku} ${row.name} ${row.binId} ${row.lot} ${row.category}`.toLowerCase();
  return terms.every((t) => hay.includes(t));
}

function compare(a: InventoryRow, b: InventoryRow, key: SortKey): number {
  switch (key) {
    case 'cases': case 'units': case 'binFill':
      return a[key] - b[key];
    case 'status':
      return STATUS_RANK[a.status] - STATUS_RANK[b.status];
    case 'bestBefore':
      // Non-expiring stock sorts last when ascending.
      if (a.bestBefore === b.bestBefore) return 0;
      if (a.bestBefore === null) return 1;
      if (b.bestBefore === null) return -1;
      return a.bestBefore < b.bestBefore ? -1 : 1;
    default:
      return a[key].localeCompare(b[key], 'en', { numeric: true });
  }
}

export interface QueryResult {
  rows: InventoryRow[];
  total: number;
  page: number;
  pageCount: number;
}

export function runQuery(all: InventoryRow[], q: Query): QueryResult {
  const filtered = all.filter(
    (r) =>
      (q.zones.length === 0 || q.zones.includes(r.zone)) &&
      (q.statuses.length === 0 || q.statuses.includes(r.status)) &&
      matchesText(r, q.text),
  );
  const sign = q.dir === 'asc' ? 1 : -1;
  // Stable sort with bin + lot as the tiebreak so pages never shuffle.
  filtered.sort((a, b) => sign * compare(a, b, q.sort) || a.key.localeCompare(b.key, 'en', { numeric: true }));
  const pageCount = Math.max(1, Math.ceil(filtered.length / q.pageSize));
  const page = Math.min(Math.max(1, q.page), pageCount);
  const start = (page - 1) * q.pageSize;
  return { rows: filtered.slice(start, start + q.pageSize), total: filtered.length, page, pageCount };
}

export interface Summary {
  skus: number;
  bins: number;
  occupiedBins: number;
  cases: number;
  units: number;
  low: number;
  expiring: number;
  expired: number;
}

/** Headline numbers, all computed from the seeded data. */
export function summarize(wh: Warehouse, rows: InventoryRow[]): Summary {
  const occupied = new Set(rows.map((r) => r.binId));
  const count = (s: StockStatus) => rows.filter((r) => r.status === s).length;
  return {
    skus: wh.skus.length,
    bins: wh.bins.length,
    occupiedBins: occupied.size,
    cases: rows.reduce((n, r) => n + r.cases, 0),
    units: rows.reduce((n, r) => n + r.units, 0),
    low: count('low'),
    expiring: count('expiring'),
    expired: count('expired'),
  };
}

/** Serialise / parse the query to the URL hash so a filtered view can be shared or bookmarked. */
export function queryToHash(q: Query): string {
  const p = new URLSearchParams();
  if (q.text) p.set('q', q.text);
  if (q.zones.length) p.set('zone', q.zones.join(','));
  if (q.statuses.length) p.set('status', q.statuses.join(','));
  if (q.sort !== DEFAULT_QUERY.sort) p.set('sort', q.sort);
  if (q.dir !== DEFAULT_QUERY.dir) p.set('dir', q.dir);
  if (q.page !== 1) p.set('page', String(q.page));
  const s = p.toString();
  return s ? `#${s}` : '';
}

const SORT_KEYS: SortKey[] = ['sku', 'name', 'zone', 'binId', 'cases', 'units', 'bestBefore', 'binFill', 'status'];
const ZONE_IDS: ZoneId[] = ['A', 'B', 'C', 'D'];
const STATUSES: StockStatus[] = ['ok', 'low', 'expiring', 'expired'];

export function hashToQuery(hash: string): Query {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const sort = p.get('sort') as SortKey | null;
  const page = Number(p.get('page'));
  return {
    ...DEFAULT_QUERY,
    text: p.get('q') ?? '',
    zones: (p.get('zone') ?? '').split(',').filter((z): z is ZoneId => ZONE_IDS.includes(z as ZoneId)),
    statuses: (p.get('status') ?? '').split(',').filter((s): s is StockStatus => STATUSES.includes(s as StockStatus)),
    sort: sort && SORT_KEYS.includes(sort) ? sort : DEFAULT_QUERY.sort,
    dir: p.get('dir') === 'desc' ? 'desc' : 'asc',
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}
