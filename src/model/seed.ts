import { addDays } from './dates';
import { createRng, type Rng } from './rng';
import type {
  Bin, BinSize, Category, Dock, InventoryRecord, Sku, StorageType, Warehouse, Zone,
} from './types';

export const DEFAULT_SEED = 20261031;
export const DEFAULT_AS_OF = '2026-10-31';

export const ZONES: Zone[] = [
  { id: 'A', name: 'Ambient racking', storage: 'ambient', aisles: 6 },
  { id: 'B', name: 'Chilled room', storage: 'chilled', aisles: 4 },
  { id: 'C', name: 'Freezer', storage: 'frozen', aisles: 3 },
  { id: 'D', name: 'Bulk floor', storage: 'bulk', aisles: 3 },
];

export const LEVELS = ['A', 'B', 'C', 'D'] as const;
export const POSITIONS_PER_LEVEL = 6;
export const CAPACITY_BY_SIZE: Record<BinSize, number> = { S: 20, M: 40, L: 80 };

/** Which storage type each category must live in. */
export const CATEGORY_STORAGE: Record<Category, StorageType> = {
  Dairy: 'chilled',
  Cheese: 'chilled',
  Frozen: 'frozen',
  Beverages: 'bulk',
  'Dry goods': 'ambient',
  Household: 'ambient',
  Packaging: 'bulk',
};

/** Shelf life in days per category, or null if it does not expire. */
const SHELF_LIFE: Record<Category, [number, number] | null> = {
  Dairy: [10, 28],
  Cheese: [45, 180],
  Frozen: [180, 365],
  Beverages: [120, 300],
  'Dry goods': [180, 540],
  Household: null,
  Packaging: null,
};

const NAME_PARTS: Record<Category, { items: string[]; variants: string[] }> = {
  Dairy: {
    items: ['Whole milk', '2% milk', 'Skim milk', 'Greek yogurt', 'Plain yogurt', 'Butter', 'Sour cream', 'Cream 35%', 'Kefir'],
    variants: ['1 L', '2 L', '4 L', '500 g', '750 g', '250 g'],
  },
  Cheese: {
    items: ['Mozzarella', 'Old cheddar', 'Mild cheddar', 'Brie', 'Feta', 'Parmesan', 'Swiss', 'Cream cheese'],
    variants: ['200 g', '400 g', '1 kg', 'shredded 320 g', 'block 2.5 kg'],
  },
  Frozen: {
    items: ['Mixed vegetables', 'Green peas', 'Fries', 'Pizza dough', 'Berries mix', 'Chicken strips', 'Ice cream vanilla', 'Ice cream chocolate'],
    variants: ['750 g', '1 kg', '2 kg', '1.5 L', '4 L'],
  },
  Beverages: {
    items: ['Sparkling water', 'Orange juice', 'Apple juice', 'Iced tea', 'Cola', 'Ginger ale', 'Spring water'],
    variants: ['12 x 355 mL', '24 x 500 mL', '6 x 2 L', '1.75 L', '8 x 1 L'],
  },
  'Dry goods': {
    items: ['Basmati rice', 'Penne', 'Spaghetti', 'Rolled oats', 'Flour', 'Sugar', 'Black beans', 'Chickpeas', 'Peanut butter', 'Tomato sauce'],
    variants: ['500 g', '900 g', '2 kg', '8 kg', '540 mL', '1 kg'],
  },
  Household: {
    items: ['Paper towel', 'Bathroom tissue', 'Dish soap', 'Laundry detergent', 'Garbage bags', 'Hand soap'],
    variants: ['6 rolls', '12 rolls', '24 rolls', '740 mL', '4.4 L', '40 count'],
  },
  Packaging: {
    items: ['Corrugated box', 'Stretch wrap', 'Pallet label', 'Packing tape', 'Void fill paper'],
    variants: ['small', 'medium', 'large', '18 in x 1500 ft', 'roll of 500'],
  },
};

const CATEGORY_CODE: Record<Category, string> = {
  Dairy: 'DAI', Cheese: 'CHE', Frozen: 'FRZ', Beverages: 'BEV',
  'Dry goods': 'DRY', Household: 'HHD', Packaging: 'PKG',
};

export function binId(zone: string, aisle: number, level: string, position: number): string {
  return `${zone}-${String(aisle).padStart(2, '0')}-${level}-${position}`;
}

function buildBins(rng: Rng): Bin[] {
  const bins: Bin[] = [];
  let aisleX = 0;
  for (const zone of ZONES) {
    for (let aisle = 1; aisle <= zone.aisles; aisle++) {
      // Two grid columns per aisle: rack + walkway. Racks start at y = 2 (docks sit at y = 0).
      const x = aisleX * 2 + 1;
      for (const level of LEVELS) {
        for (let position = 1; position <= POSITIONS_PER_LEVEL; position++) {
          // Bulk floor uses large bins only; ground level (A) is larger elsewhere.
          const size: BinSize =
            zone.storage === 'bulk' ? 'L' : level === 'A' ? (rng.chance(0.5) ? 'L' : 'M') : rng.chance(0.3) ? 'S' : 'M';
          bins.push({
            id: binId(zone.id, aisle, level, position),
            zone: zone.id,
            aisle,
            level,
            position,
            size,
            capacity: CAPACITY_BY_SIZE[size],
            x,
            y: position + 1,
          });
        }
      }
      aisleX++;
    }
  }
  return bins;
}

function buildDocks(totalAisles: number): Dock[] {
  const width = totalAisles * 2 + 1;
  const docks: Dock[] = [];
  for (let i = 0; i < 6; i++) {
    docks.push({ id: `IN-${i + 1}`, kind: 'inbound', door: i + 1, x: Math.round(((i + 0.5) * width) / 6), y: 0 });
  }
  for (let i = 0; i < 6; i++) {
    docks.push({
      id: `OUT-${i + 1}`, kind: 'outbound', door: i + 7,
      x: Math.round(((i + 0.5) * width) / 6), y: POSITIONS_PER_LEVEL + 3,
    });
  }
  return docks;
}

function buildSkus(rng: Rng): Sku[] {
  const skus: Sku[] = [];
  const seen = new Set<string>();
  (Object.keys(NAME_PARTS) as Category[]).forEach((category) => {
    const { items, variants } = NAME_PARTS[category];
    let n = 1;
    for (const item of items) {
      const count = rng.int(2, 4);
      const pool = [...variants];
      for (let k = 0; k < count && pool.length > 0; k++) {
        const variant = pool.splice(rng.int(0, pool.length - 1), 1)[0];
        const name = `${item}, ${variant}`;
        if (seen.has(name)) continue;
        seen.add(name);
        skus.push({
          sku: `${CATEGORY_CODE[category]}-${String(n++).padStart(4, '0')}`,
          name,
          category,
          storage: CATEGORY_STORAGE[category],
          unitsPerCase: rng.pick([4, 6, 8, 12, 12, 24]),
          caseWeightKg: Math.round((2 + rng.next() * 16) * 10) / 10,
          reorderPoint: rng.int(4, 18),
        });
      }
    }
  });
  return skus;
}

function buildInventory(rng: Rng, bins: Bin[], skus: Sku[], asOf: string): InventoryRecord[] {
  const zoneStorage = new Map(ZONES.map((z) => [z.id, z.storage]));
  const skusByStorage = new Map<StorageType, Sku[]>();
  for (const s of skus) {
    const list = skusByStorage.get(s.storage) ?? [];
    list.push(s);
    skusByStorage.set(s.storage, list);
  }
  const records: InventoryRecord[] = [];
  let lotCounter = 1000;
  for (const bin of bins) {
    if (rng.chance(0.22)) continue; // empty bin
    const candidates = skusByStorage.get(zoneStorage.get(bin.zone)!) ?? [];
    if (candidates.length === 0) continue;
    const sku = rng.pick(candidates);
    // Some bins hold two lots of the same SKU (common for FEFO rotation).
    const lots = rng.chance(0.18) ? 2 : 1;
    let remaining = bin.capacity;
    for (let l = 0; l < lots && remaining > 0; l++) {
      const cases = rng.chance(0.08) ? rng.int(1, 3) : rng.int(1, Math.max(1, Math.floor(remaining * 0.9)));
      remaining -= cases;
      const age = rng.int(0, 60);
      const receivedOn = addDays(asOf, -age);
      const life = SHELF_LIFE[sku.category];
      // A small share of chilled/frozen stock is deliberately near or past expiry to exercise statuses.
      const bestBefore = life ? addDays(receivedOn, rng.chance(0.06) ? rng.int(Math.max(1, age - 3), age + 6) : rng.int(life[0], life[1])) : null;
      records.push({
        sku: sku.sku,
        binId: bin.id,
        cases,
        lot: `L${lotCounter++}`,
        receivedOn,
        bestBefore,
      });
    }
  }
  return records;
}

/** Build the whole fake warehouse from a seed. Same seed, same warehouse. */
export function generateWarehouse(seed = DEFAULT_SEED, asOf = DEFAULT_AS_OF): Warehouse {
  const rng = createRng(seed);
  const bins = buildBins(rng);
  const skus = buildSkus(rng);
  const inventory = buildInventory(rng, bins, skus, asOf);
  const docks = buildDocks(ZONES.reduce((n, z) => n + z.aisles, 0));
  return { seed, asOf, zones: ZONES, bins, docks, skus, inventory };
}
