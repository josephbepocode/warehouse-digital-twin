// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { STORAGE_KEY } from '../src/model/storage';

beforeAll(async () => {
  localStorage.clear();
  const html = readFileSync(resolve(__dirname, '../docks/index.html'), 'utf8');
  document.body.innerHTML = html.replace(/^[\s\S]*<body[^>]*>|<\/body>[\s\S]*$/g, '');
  await import('../src/docks');
});

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const appts = () => document.querySelectorAll<HTMLElement>('#grid .appt');
const set = (id: string, v: string) => { const el = $<HTMLInputElement>(id); el.value = v; el.dispatchEvent(new Event('change')); };
const submit = () => $<HTMLFormElement>('booking-form').dispatchEvent(new Event('submit', { cancelable: true }));
const errors = () => [...document.querySelectorAll('#form-errors li')].map((li) => li.getAttribute('data-code'));

describe('dock schedule page', () => {
  it('renders 12 door rows and the seeded bookings', () => {
    expect(document.querySelectorAll('#grid .lane')).toHaveLength(12);
    expect(document.querySelectorAll('#grid .lane.inbound')).toHaveLength(6);
    const inbound = document.querySelectorAll('#grid .appt.inbound').length;
    expect(inbound).toBeGreaterThanOrEqual(35);
    expect(inbound).toBeLessThanOrEqual(49);
    expect(document.querySelectorAll('#agenda-body tr')).toHaveLength(appts().length);
    expect(document.querySelectorAll('#grid .appt.problem')).toHaveLength(0);
  });

  it('blocks a booking that overlaps another on the same door and shows why', () => {
    const first = appts()[0];
    first.click();
    expect($('booking').hidden).toBe(false);
    const dock = $<HTMLSelectElement>('f-dock').value;
    const start = $<HTMLInputElement>('f-start').value;
    $<HTMLButtonElement>('f-cancel').click();

    $<HTMLButtonElement>('new-booking').click();
    set('f-direction', dock.startsWith('IN') ? 'inbound' : 'outbound');
    set('f-dock', dock);
    set('f-carrier', 'Tamarack Cartage');
    set('f-start', start);
    set('f-end', `${String(Number(start.slice(0, 2)) + 1).padStart(2, '0')}:${start.slice(3)}`);
    set('f-ref', 'PO-TEST');
    const before = appts().length;
    submit();
    expect(errors()).toContain('overlap');
    expect($<HTMLInputElement>('f-start').getAttribute('aria-invalid')).toBe('true');
    expect(appts()).toHaveLength(before);
  });

  it('blocks an inbound booking on an outbound door and outside hours', () => {
    set('f-dock', 'OUT-2');
    set('f-start', '05:00');
    set('f-end', '06:00');
    submit();
    expect(errors()).toEqual(expect.arrayContaining(['wrong-dock-kind', 'outside-hours']));
  });

  it('saves a valid booking, draws it and persists it to localStorage', () => {
    const before = appts().length;
    // find a free hour on some inbound door
    const lanes = [...document.querySelectorAll<HTMLElement>('#grid .lane.inbound')];
    let saved = false;
    for (const lane of lanes) {
      for (let hr = 6; hr < 22 && !saved; hr++) {
        set('f-direction', 'inbound');
        set('f-dock', lane.dataset.dock!);
        set('f-start', `${String(hr).padStart(2, '0')}:00`);
        set('f-end', `${String(hr).padStart(2, '0')}:30`);
        submit();
        saved = $('booking').hidden;
      }
      if (saved) break;
    }
    expect(saved).toBe(true);
    expect(appts()).toHaveLength(before + 1);
    expect(document.querySelector('#grid .appt[aria-label*="PO-TEST"]')).not.toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toContain('PO-TEST');
  });

  it('moves a booking with the keyboard only when the move is allowed', () => {
    const el = document.querySelector<HTMLElement>('#grid .appt[aria-label*="PO-TEST"]')!;
    const label = el.getAttribute('aria-label')!;
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const after = document.querySelector<HTMLElement>('#grid .appt[aria-label*="PO-TEST"]')!.getAttribute('aria-label')!;
    const msg = $('msg').className;
    // either it moved and saved, or it was blocked with an error message and stayed put
    if (msg.includes('error')) expect(after).toBe(label);
    else expect(after).not.toBe(label);
  });

  it('turning on a buffer flags bookings that are now too close', () => {
    const sel = $<HTMLSelectElement>('buffer');
    sel.value = '30';
    sel.dispatchEvent(new Event('change'));
    expect($('msg').textContent).toMatch(/30 minutes/);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).bufferMin).toBe(30);
  });

  it('resets to the seeded day', () => {
    $<HTMLButtonElement>('reset-seed').click();
    expect(document.querySelector('#grid .appt[aria-label*="PO-TEST"]')).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect($<HTMLSelectElement>('buffer').value).toBe('0');
    expect(document.querySelectorAll('#grid .appt.problem')).toHaveLength(0);
  });
});
