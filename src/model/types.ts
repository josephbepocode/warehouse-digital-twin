/** Core data model for the warehouse operations platform. */

export type ZoneId = 'A' | 'B' | 'C' | 'D';

export type StorageType = 'ambient' | 'chilled' | 'frozen' | 'bulk';

export interface Zone {
  id: ZoneId;
  name: string;
  storage: StorageType;
  aisles: number;
}

export type BinSize = 'S' | 'M' | 'L';

export interface Bin {
  /** Location code, e.g. "A-03-B-2" = zone A, aisle 3, level B, position 2. */
  id: string;
  zone: ZoneId;
  aisle: number;
  level: string;
  position: number;
  size: BinSize;
  /** Max units of a standard-sized case this bin can hold. */
  capacity: number;
  /** Grid coordinates on the floor plan, used by later milestones (pick paths). */
  x: number;
  y: number;
}

export type DockKind = 'inbound' | 'outbound';

export interface Dock {
  id: string;
  kind: DockKind;
  door: number;
  x: number;
  y: number;
}

export type Category =
  | 'Dairy'
  | 'Cheese'
  | 'Frozen'
  | 'Beverages'
  | 'Dry goods'
  | 'Household'
  | 'Packaging';

export interface Sku {
  sku: string;
  name: string;
  category: Category;
  storage: StorageType;
  unitsPerCase: number;
  /** Case weight in kilograms. */
  caseWeightKg: number;
  /** Below this many cases the SKU counts as low stock. */
  reorderPoint: number;
}

export interface InventoryRecord {
  sku: string;
  binId: string;
  cases: number;
  lot: string;
  /** ISO date (YYYY-MM-DD). */
  receivedOn: string;
  /** ISO date, or null when the product doesn't expire. */
  bestBefore: string | null;
}

export interface Warehouse {
  seed: number;
  /** ISO date used as "today" for the seeded data, so expiry is deterministic. */
  asOf: string;
  zones: Zone[];
  bins: Bin[];
  docks: Dock[];
  skus: Sku[];
  inventory: InventoryRecord[];
}

export type StockStatus = 'ok' | 'low' | 'expiring' | 'expired';

/** A flattened, display-ready row joining inventory, SKU and bin. */
export interface InventoryRow {
  key: string;
  sku: string;
  name: string;
  category: Category;
  storage: StorageType;
  zone: ZoneId;
  binId: string;
  cases: number;
  units: number;
  lot: string;
  receivedOn: string;
  bestBefore: string | null;
  daysToExpiry: number | null;
  /** Bin fill as a fraction 0..1. */
  binFill: number;
  status: StockStatus;
}
