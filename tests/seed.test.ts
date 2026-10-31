import { generateWarehouse, ZONES, POSITIONS_PER_LEVEL, LEVELS } from '../src/model/seed';
import { validateWarehouse } from '../src/model/validate';

describe('generateWarehouse', () => {
  it('is deterministic for the same seed', () => {
    expect(generateWarehouse(42)).toEqual(generateWarehouse(42));
  });

  it('produces different data for different seeds', () => {
    expect(generateWarehouse(1).inventory).not.toEqual(generateWarehouse(2).inventory);
  });

  it('creates one bin per aisle, level and position', () => {
    const wh = generateWarehouse();
    const aisles = ZONES.reduce((n, z) => n + z.aisles, 0);
    expect(wh.bins).toHaveLength(aisles * LEVELS.length * POSITIONS_PER_LEVEL);
  });

  it('has 6 inbound and 6 outbound docks', () => {
    const wh = generateWarehouse();
    expect(wh.docks.filter((d) => d.kind === 'inbound')).toHaveLength(6);
    expect(wh.docks.filter((d) => d.kind === 'outbound')).toHaveLength(6);
  });

  it.each([1, 7, 99, 2026, 20261031])('passes every integrity check (seed %i)', (seed) => {
    expect(validateWarehouse(generateWarehouse(seed))).toEqual([]);
  });
});

describe('validateWarehouse', () => {
  it('catches over-capacity bins and wrong storage zones', () => {
    const wh = generateWarehouse();
    const bin = wh.bins.find((b) => b.zone === 'A')!;
    const frozen = wh.skus.find((s) => s.storage === 'frozen')!;
    wh.inventory.push({ sku: frozen.sku, binId: bin.id, cases: bin.capacity + 1, lot: 'LTEST', receivedOn: '2026-10-01', bestBefore: null });
    const problems = validateWarehouse(wh);
    expect(problems.some((p) => p.includes('over capacity'))).toBe(true);
    expect(problems.some((p) => p.includes('frozen SKU in ambient zone'))).toBe(true);
  });

  it('catches references to missing bins', () => {
    const wh = generateWarehouse();
    wh.inventory.push({ sku: wh.skus[0].sku, binId: 'Z-99-Z-9', cases: 1, lot: 'LX', receivedOn: '2026-10-01', bestBefore: null });
    expect(validateWarehouse(wh)).toContain('LX: unknown bin Z-99-Z-9');
  });
});
