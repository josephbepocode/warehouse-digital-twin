import { generateWarehouse } from '../src/model/seed';
import { buildRows, DEFAULT_QUERY, hashToQuery, matchesText, queryToHash, runQuery, summarize } from '../src/model/query';
import type { Warehouse } from '../src/model/types';

const wh = generateWarehouse();
const rows = buildRows(wh);

function tiny(): Warehouse {
  return {
    seed: 0,
    asOf: '2026-10-31',
    zones: [{ id: 'B', name: 'Chilled', storage: 'chilled', aisles: 1 }],
    bins: [
      { id: 'B-01-A-1', zone: 'B', aisle: 1, level: 'A', position: 1, size: 'M', capacity: 40, x: 1, y: 2 },
      { id: 'B-01-A-2', zone: 'B', aisle: 1, level: 'A', position: 2, size: 'M', capacity: 40, x: 1, y: 3 },
    ],
    docks: [],
    skus: [
      { sku: 'DAI-0001', name: 'Whole milk, 4 L', category: 'Dairy', storage: 'chilled', unitsPerCase: 4, caseWeightKg: 17, reorderPoint: 10 },
      { sku: 'CHE-0001', name: 'Feta, 400 g', category: 'Cheese', storage: 'chilled', unitsPerCase: 12, caseWeightKg: 5, reorderPoint: 2 },
    ],
    inventory: [
      { sku: 'DAI-0001', binId: 'B-01-A-1', cases: 3, lot: 'L1', receivedOn: '2026-10-20', bestBefore: '2026-10-30' },
      { sku: 'DAI-0001', binId: 'B-01-A-1', cases: 4, lot: 'L2', receivedOn: '2026-10-25', bestBefore: '2026-11-05' },
      { sku: 'CHE-0001', binId: 'B-01-A-2', cases: 20, lot: 'L3', receivedOn: '2026-10-01', bestBefore: '2027-01-15' },
    ],
  };
}

describe('buildRows', () => {
  it('makes one row per inventory record', () => {
    expect(rows).toHaveLength(wh.inventory.length);
  });

  it('computes units, bin fill and status from the data', () => {
    const r = buildRows(tiny());
    expect(r[0]).toMatchObject({ units: 12, status: 'expired', daysToExpiry: -1, binFill: 7 / 40 });
    expect(r[1]).toMatchObject({ status: 'expiring', daysToExpiry: 5 });
    expect(r[2]).toMatchObject({ status: 'ok', units: 240, binFill: 0.5 });
  });

  it('flags low stock when total cases for a SKU are under its reorder point', () => {
    const t = tiny();
    t.inventory = t.inventory.map((i) => ({ ...i, bestBefore: null }));
    const r = buildRows(t);
    expect(r[0].status).toBe('low'); // 7 cases total < reorder point 10
    expect(r[2].status).toBe('ok');
  });
});

describe('runQuery', () => {
  it('matches every search term, case-insensitively', () => {
    const r = buildRows(tiny())[0];
    expect(matchesText(r, 'MILK b-01')).toBe(true);
    expect(matchesText(r, 'milk feta')).toBe(false);
    expect(matchesText(r, '   ')).toBe(true);
  });

  it('filters by zone and status', () => {
    const res = runQuery(rows, { ...DEFAULT_QUERY, zones: ['C'], pageSize: 10_000 });
    expect(res.total).toBeGreaterThan(0);
    expect(res.rows.every((r) => r.zone === 'C')).toBe(true);
    const exp = runQuery(rows, { ...DEFAULT_QUERY, statuses: ['expired'], pageSize: 10_000 });
    expect(exp.rows.every((r) => r.status === 'expired')).toBe(true);
  });

  it('sorts numerically and in both directions', () => {
    const asc = runQuery(rows, { ...DEFAULT_QUERY, sort: 'cases', pageSize: 10_000 }).rows.map((r) => r.cases);
    expect(asc).toEqual([...asc].sort((a, b) => a - b));
    const desc = runQuery(rows, { ...DEFAULT_QUERY, sort: 'cases', dir: 'desc', pageSize: 10_000 }).rows.map((r) => r.cases);
    expect(desc).toEqual([...desc].sort((a, b) => b - a));
  });

  it('puts non-expiring stock last when sorting by best-before', () => {
    const res = runQuery(rows, { ...DEFAULT_QUERY, sort: 'bestBefore', pageSize: 10_000 }).rows;
    const firstNull = res.findIndex((r) => r.bestBefore === null);
    expect(firstNull).toBeGreaterThan(0);
    expect(res.slice(firstNull).every((r) => r.bestBefore === null)).toBe(true);
  });

  it('paginates and clamps out-of-range pages', () => {
    const p1 = runQuery(rows, { ...DEFAULT_QUERY, pageSize: 25 });
    expect(p1.rows).toHaveLength(25);
    expect(p1.pageCount).toBe(Math.ceil(rows.length / 25));
    const far = runQuery(rows, { ...DEFAULT_QUERY, pageSize: 25, page: 9999 });
    expect(far.page).toBe(p1.pageCount);
    const none = runQuery(rows, { ...DEFAULT_QUERY, text: 'no-such-thing-xyz' });
    expect(none).toMatchObject({ total: 0, page: 1, pageCount: 1 });
  });
});

describe('summarize', () => {
  it('adds up the seeded data', () => {
    const s = summarize(wh, rows);
    expect(s.cases).toBe(wh.inventory.reduce((n, i) => n + i.cases, 0));
    expect(s.occupiedBins).toBeLessThanOrEqual(s.bins);
    expect(s.low + s.expiring + s.expired).toBeLessThanOrEqual(rows.length);
  });
});

describe('URL hash round trip', () => {
  it('restores the same query', () => {
    const q = { ...DEFAULT_QUERY, text: 'milk', zones: ['B' as const], statuses: ['low' as const], sort: 'cases' as const, dir: 'desc' as const, page: 3 };
    expect(hashToQuery(queryToHash(q))).toEqual(q);
  });

  it('ignores junk values', () => {
    expect(hashToQuery('#zone=Q,B&sort=evil&page=-4')).toEqual({ ...DEFAULT_QUERY, zones: ['B'] });
  });

  it('is empty for the default query', () => {
    expect(queryToHash(DEFAULT_QUERY)).toBe('');
  });
});
