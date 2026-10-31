import type { Warehouse } from './types';

/** Integrity checks for a warehouse. Returns a list of problems; empty means valid. */
export function validateWarehouse(wh: Warehouse): string[] {
  const problems: string[] = [];
  const zoneStorage = new Map(wh.zones.map((z) => [z.id, z.storage]));
  const bins = new Map(wh.bins.map((b) => [b.id, b]));
  const skus = new Map(wh.skus.map((s) => [s.sku, s]));
  if (bins.size !== wh.bins.length) problems.push('duplicate bin ids');
  if (skus.size !== wh.skus.length) problems.push('duplicate SKU codes');
  const lots = new Set<string>();
  const fill = new Map<string, number>();
  for (const r of wh.inventory) {
    const bin = bins.get(r.binId);
    const sku = skus.get(r.sku);
    if (!bin) { problems.push(`${r.lot}: unknown bin ${r.binId}`); continue; }
    if (!sku) { problems.push(`${r.lot}: unknown SKU ${r.sku}`); continue; }
    if (lots.has(r.lot)) problems.push(`duplicate lot ${r.lot}`);
    lots.add(r.lot);
    if (r.cases <= 0) problems.push(`${r.lot}: non-positive case count`);
    if (zoneStorage.get(bin.zone) !== sku.storage) problems.push(`${r.lot}: ${sku.storage} SKU in ${zoneStorage.get(bin.zone)} zone`);
    if (r.bestBefore && r.bestBefore < r.receivedOn) problems.push(`${r.lot}: best-before earlier than received date`);
    fill.set(bin.id, (fill.get(bin.id) ?? 0) + r.cases);
  }
  for (const [id, cases] of fill) {
    const cap = bins.get(id)!.capacity;
    if (cases > cap) problems.push(`${id}: ${cases} cases over capacity ${cap}`);
  }
  return problems;
}
