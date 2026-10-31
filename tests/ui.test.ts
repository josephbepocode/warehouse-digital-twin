// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

beforeAll(async () => {
  const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
  document.body.innerHTML = html.replace(/^[\s\S]*<body>|<\/body>[\s\S]*$/g, '');
  await import('../src/main');
});

const rows = () => document.querySelectorAll('#body tr:not(.empty)');
const count = () => document.getElementById('count')!.textContent!;
const flush = () => new Promise((r) => setTimeout(r, 200));

describe('inventory page', () => {
  it('renders the first page of 50 rows and the summary cards', () => {
    expect(rows()).toHaveLength(50);
    expect(document.querySelectorAll('#stats .stat')).toHaveLength(7);
    expect(count()).toMatch(/^Showing 1–50 of \d+ lots$/);
  });

  it('filters as you type', async () => {
    const q = document.getElementById('q') as HTMLInputElement;
    q.value = 'cheddar';
    q.dispatchEvent(new Event('input'));
    await flush();
    expect(rows().length).toBeGreaterThan(0);
    rows().forEach((r) => expect(r.textContent!.toLowerCase()).toContain('cheddar'));
    expect(location.hash).toBe('#q=cheddar');
  });

  it('shows an empty state when nothing matches', async () => {
    const q = document.getElementById('q') as HTMLInputElement;
    q.value = 'zzzz-nothing';
    q.dispatchEvent(new Event('input'));
    await flush();
    expect(rows()).toHaveLength(0);
    expect(document.querySelector('#body .empty')).not.toBeNull();
  });

  it('sorts from the column header and sets aria-sort', () => {
    (document.getElementById('reset') as HTMLButtonElement).click();
    const btn = document.querySelector<HTMLButtonElement>('button[data-sort=cases]')!;
    btn.click();
    expect(btn.closest('th')!.getAttribute('aria-sort')).toBe('ascending');
    btn.click();
    expect(btn.closest('th')!.getAttribute('aria-sort')).toBe('descending');
    const first = Number(rows()[0].querySelector('td[data-label=Cases]')!.textContent!.replace(/\D/g, ''));
    const second = Number(rows()[1].querySelector('td[data-label=Cases]')!.textContent!.replace(/\D/g, ''));
    expect(first).toBeGreaterThanOrEqual(second);
  });

  it('filters by zone chip', () => {
    (document.getElementById('reset') as HTMLButtonElement).click();
    const chip = document.querySelector<HTMLInputElement>('input[name=zone][value=C]')!;
    chip.click();
    rows().forEach((r) => expect(r.querySelector('td[data-label=Zone]')!.textContent).toBe('C'));
  });
});
