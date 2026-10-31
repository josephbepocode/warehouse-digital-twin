import './style.css';
import { generateWarehouse } from './model/seed';
import {
  buildRows, DEFAULT_QUERY, hashToQuery, queryToHash, runQuery, summarize,
  type Query, type SortKey,
} from './model/query';
import type { InventoryRow, StockStatus, ZoneId } from './model/types';

const wh = generateWarehouse();
const allRows = buildRows(wh);
const summary = summarize(wh, allRows);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = new Intl.NumberFormat('en-CA');

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: 'sku', label: 'SKU' },
  { key: 'name', label: 'Product' },
  { key: 'binId', label: 'Bin' },
  { key: 'zone', label: 'Zone' },
  { key: 'cases', label: 'Cases', numeric: true },
  { key: 'units', label: 'Units', numeric: true },
  { key: 'binFill', label: 'Bin fill', numeric: true },
  { key: 'bestBefore', label: 'Best before' },
  { key: 'status', label: 'Status' },
];

const STATUS_LABEL: Record<StockStatus, string> = {
  ok: 'OK', low: 'Low stock', expiring: 'Expiring ≤7d', expired: 'Expired',
};

let query: Query = hashToQuery(location.hash);

$('seed').textContent = String(wh.seed);
$('asof').textContent = wh.asOf;

// ---- summary cards (all computed from the seeded data) ----
$('stats').innerHTML = [
  ['SKUs', fmt.format(summary.skus)],
  ['Bins in use', `${fmt.format(summary.occupiedBins)} / ${fmt.format(summary.bins)}`],
  ['Cases on hand', fmt.format(summary.cases)],
  ['Units on hand', fmt.format(summary.units)],
  ['Low-stock lots', fmt.format(summary.low)],
  ['Expiring lots', fmt.format(summary.expiring)],
  ['Expired lots', fmt.format(summary.expired)],
]
  .map(([k, v]) => `<div class="stat"><span class="k">${k}</span><span class="v">${v}</span></div>`)
  .join('');

// ---- filter chips ----
function chip(group: string, value: string, label: string): string {
  return `<label class="chip"><input type="checkbox" name="${group}" value="${value}" /><span>${label}</span></label>`;
}
$('zones').innerHTML = wh.zones.map((z) => chip('zone', z.id, `${z.id} · ${z.name}`)).join('');
$('statuses').innerHTML = (Object.keys(STATUS_LABEL) as StockStatus[])
  .map((s) => chip('status', s, STATUS_LABEL[s])).join('');

// ---- table header ----
$('head').innerHTML = COLUMNS.map(
  (c) => `<th scope="col" data-key="${c.key}"${c.numeric ? ' class="num"' : ''}><button type="button" data-sort="${c.key}">${c.label}<span class="arrow" aria-hidden="true"></span></button></th>`,
).join('');

// ---- sort dropdown (same state as the headers; useful on phones where headers are hidden) ----
const sortSel = $<HTMLSelectElement>('sortsel');
sortSel.innerHTML = COLUMNS.flatMap((c) => [
  `<option value="${c.key}:asc">${c.label} (ascending)</option>`,
  `<option value="${c.key}:desc">${c.label} (descending)</option>`,
]).join('');
sortSel.addEventListener('change', () => {
  const [sort, dir] = sortSel.value.split(':') as [SortKey, 'asc' | 'desc'];
  query = { ...query, sort, dir, page: 1 };
  render();
});

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function expiryText(r: InventoryRow): string {
  if (!r.bestBefore || r.daysToExpiry === null) return '<span class="muted">No expiry</span>';
  const d = r.daysToExpiry;
  const rel = d < 0 ? `${-d}d ago` : d === 0 ? 'today' : `in ${d}d`;
  return `${r.bestBefore} <span class="muted">(${rel})</span>`;
}

function rowHtml(r: InventoryRow): string {
  const pct = Math.round(r.binFill * 100);
  return `<tr>
    <td data-label="SKU"><code>${r.sku}</code></td>
    <td data-label="Product">${esc(r.name)}<span class="cat">${r.category} · lot ${r.lot}</span></td>
    <td data-label="Bin"><code>${r.binId}</code></td>
    <td data-label="Zone">${r.zone}</td>
    <td data-label="Cases" class="num">${fmt.format(r.cases)}</td>
    <td data-label="Units" class="num">${fmt.format(r.units)}</td>
    <td data-label="Bin fill" class="num"><span class="fill" style="--p:${pct}%" aria-hidden="true"></span>${pct}%</td>
    <td data-label="Best before">${expiryText(r)}</td>
    <td data-label="Status"><span class="badge ${r.status}">${STATUS_LABEL[r.status]}</span></td>
  </tr>`;
}

function render(): void {
  const res = runQuery(allRows, query);
  query.page = res.page;
  $('body').innerHTML = res.rows.length
    ? res.rows.map(rowHtml).join('')
    : `<tr class="empty"><td colspan="${COLUMNS.length}">No inventory matches. Try fewer words or clear the filters.</td></tr>`;

  const from = res.total === 0 ? 0 : (res.page - 1) * query.pageSize + 1;
  const to = Math.min(res.total, res.page * query.pageSize);
  $('count').textContent = `Showing ${fmt.format(from)}–${fmt.format(to)} of ${fmt.format(res.total)} lots`;
  $('pageinfo').textContent = `Page ${res.page} of ${res.pageCount}`;
  $<HTMLButtonElement>('prev').disabled = res.page <= 1;
  $<HTMLButtonElement>('next').disabled = res.page >= res.pageCount;

  document.querySelectorAll<HTMLTableCellElement>('#head th').forEach((th) => {
    const active = th.dataset.key === query.sort;
    th.setAttribute('aria-sort', active ? (query.dir === 'asc' ? 'ascending' : 'descending') : 'none');
  });

  sortSel.value = `${query.sort}:${query.dir}`;

  const hash = queryToHash(query);
  if (hash !== location.hash) history.replaceState(null, '', hash || location.pathname + location.search);
}

function syncControls(): void {
  $<HTMLInputElement>('q').value = query.text;
  document.querySelectorAll<HTMLInputElement>('input[name=zone]').forEach((i) => (i.checked = query.zones.includes(i.value as ZoneId)));
  document.querySelectorAll<HTMLInputElement>('input[name=status]').forEach((i) => (i.checked = query.statuses.includes(i.value as StockStatus)));
}

// ---- events ----
let timer: number | undefined;
$<HTMLInputElement>('q').addEventListener('input', (e) => {
  window.clearTimeout(timer);
  const value = (e.target as HTMLInputElement).value;
  timer = window.setTimeout(() => { query = { ...query, text: value, page: 1 }; render(); }, 120);
});

document.querySelector('.controls')!.addEventListener('change', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.name !== 'zone' && t.name !== 'status') return;
  const checked = (name: string) =>
    [...document.querySelectorAll<HTMLInputElement>(`input[name=${name}]:checked`)].map((i) => i.value);
  query = { ...query, zones: checked('zone') as ZoneId[], statuses: checked('status') as StockStatus[], page: 1 };
  render();
});

$('head').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-sort]');
  if (!btn) return;
  const key = btn.dataset.sort as SortKey;
  query = { ...query, sort: key, dir: query.sort === key && query.dir === 'asc' ? 'desc' : 'asc', page: 1 };
  render();
});

$('prev').addEventListener('click', () => { query = { ...query, page: query.page - 1 }; render(); });
$('next').addEventListener('click', () => { query = { ...query, page: query.page + 1 }; render(); });
$('reset').addEventListener('click', () => { query = { ...DEFAULT_QUERY }; syncControls(); render(); $('q').focus(); });

document.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') { e.preventDefault(); $('q').focus(); }
});

window.addEventListener('hashchange', () => { query = hashToQuery(location.hash); syncControls(); render(); });

syncControls();
render();
