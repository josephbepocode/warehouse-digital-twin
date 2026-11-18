import './style.css';
import './docks.css';
import { generateWarehouse } from './model/seed';
import { CARRIERS, generateAppointments, STATUSES } from './model/docks';
import {
  BUFFER_OPTIONS, checkAppointment, checkSchedule, DEFAULT_RULES, fromHHMM, toHHMM, utilisation,
  xToMinute, xToSlotStart, type Conflict,
} from './model/schedule';
import { clearSchedule, loadSchedule, saveSchedule } from './model/storage';
import type { Appointment, AppointmentStatus, Dock, DockKind, DockRules, DockSchedule } from './model/types';

const wh = generateWarehouse();
const seeded = (): DockSchedule => generateAppointments(wh);
const saved = loadSchedule(localStorage, wh.seed, wh.asOf);
let schedule: DockSchedule = saved?.schedule ?? seeded();
let edited = saved !== null;
let rules: DockRules = { ...DEFAULT_RULES, bufferMin: saved?.bufferMin ?? 0 };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const docks = wh.docks;
const dockById = new Map(docks.map((d) => [d.id, d]));
const SLOTS = (rules.close - rules.open) / rules.slot;

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  booked: 'Booked', 'checked-in': 'Checked in', 'in-progress': 'On the door', done: 'Done', late: 'Running late',
};
const KIND_LABEL: Record<DockKind, string> = { inbound: 'Inbound', outbound: 'Outbound' };

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

$('seed').textContent = String(wh.seed);
$('day').textContent = schedule.date;

// ---- static controls ----
$<HTMLSelectElement>('buffer').innerHTML = BUFFER_OPTIONS
  .map((b) => `<option value="${b}">${b === 0 ? 'None' : `${b} minutes`}</option>`).join('');
$<HTMLSelectElement>('f-dock').innerHTML = (['inbound', 'outbound'] as DockKind[]).map((k) =>
  `<optgroup label="${KIND_LABEL[k]} doors">${docks.filter((d) => d.kind === k)
    .map((d) => `<option value="${d.id}">${d.id} (door ${d.door})</option>`).join('')}</optgroup>`).join('');
$<HTMLSelectElement>('f-carrier').innerHTML = `<option value="">Choose a carrier</option>`
  + CARRIERS.map((c) => `<option>${c}</option>`).join('');
$<HTMLSelectElement>('f-status').innerHTML = STATUSES.map((s) => `<option value="${s}">${STATUS_LABEL[s]}</option>`).join('');

// ---- grid skeleton (rows = docks, columns = 30-minute slots) ----
const grid = $('grid');
grid.style.setProperty('--slots', String(SLOTS));
const hourTicks: string[] = [];
for (let t = rules.open; t < rules.close; t += 60) {
  hourTicks.push(`<span class="tick" style="left:calc(${(t - rules.open) / rules.slot} * var(--slot-w))">${toHHMM(t)}</span>`);
}
grid.innerHTML = `<div class="corner">Door</div><div class="times" aria-hidden="true">${hourTicks.join('')}</div>`
  + docks.map((d) => `<div class="dock-label ${d.kind}" id="label-${d.id}"><strong>${d.id}</strong><span>${KIND_LABEL[d.kind]}</span></div>`
    + `<div class="lane ${d.kind}" data-dock="${d.id}" role="group" aria-labelledby="label-${d.id}"></div>`).join('');
const lanes = new Map<string, HTMLElement>();
grid.querySelectorAll<HTMLElement>('.lane').forEach((l) => lanes.set(l.dataset.dock!, l));

// ---- rendering ----
function place(el: HTMLElement, start: number, end: number): void {
  el.style.left = `calc(${(start - rules.open) / rules.slot} * var(--slot-w))`;
  el.style.width = `calc(${(end - start) / rules.slot} * var(--slot-w) - 3px)`;
}

function apptLabel(a: Appointment, problems?: Conflict[]): string {
  const base = `${KIND_LABEL[a.direction]} ${a.reference}, ${a.carrier}, ${a.dockId}, ${toHHMM(a.start)} to ${toHHMM(a.end)}, ${STATUS_LABEL[a.status]}`;
  return problems?.length ? `${base}. Problem: ${problems.map((p) => p.message).join(' ')}` : base;
}

function render(focusId?: string): void {
  const problems = checkSchedule(schedule.appointments, docks, rules);
  lanes.forEach((l) => (l.innerHTML = ''));
  for (const a of schedule.appointments) {
    const lane = lanes.get(a.dockId);
    if (!lane) continue;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `appt ${a.direction} st-${a.status}${problems.has(a.id) ? ' problem' : ''}`;
    el.dataset.id = a.id;
    el.setAttribute('aria-label', apptLabel(a, problems.get(a.id)));
    el.innerHTML = `<span class="h start" data-handle="start" aria-hidden="true"></span>`
      + `<span class="ref">${esc(a.reference)}</span><span class="car">${esc(a.carrier)}</span>`
      + `<span class="h end" data-handle="end" aria-hidden="true"></span>`;
    place(el, a.start, a.end);
    lane.appendChild(el);
  }

  const appts = schedule.appointments;
  const inbound = appts.filter((a) => a.direction === 'inbound').length;
  $('stats').innerHTML = [
    ['Bookings', String(appts.length)],
    ['Inbound receipts', String(inbound)],
    ['Outbound loads', String(appts.length - inbound)],
    ['Inbound door use', `${Math.round(utilisation(appts.filter((a) => a.direction === 'inbound'), docks.filter((d) => d.kind === 'inbound'), rules) * 100)}%`],
    ['Rule problems', String(problems.size)],
    ['Data', edited ? 'Edited, saved here' : 'Seeded day'],
  ].map(([k, v]) => `<div class="stat"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');

  $('agenda-body').innerHTML = [...appts].sort((x, y) => x.start - y.start || x.dockId.localeCompare(y.dockId, 'en', { numeric: true }))
    .map((a) => `<tr${problems.has(a.id) ? ' class="problem-row"' : ''}>
      <td data-label="Time">${toHHMM(a.start)} to ${toHHMM(a.end)}</td>
      <td data-label="Door"><code>${a.dockId}</code></td>
      <td data-label="Type">${KIND_LABEL[a.direction]}</td>
      <td data-label="Carrier">${esc(a.carrier)}</td>
      <td data-label="Reference"><code>${esc(a.reference)}</code></td>
      <td data-label="Trailer"><code>${esc(a.trailer)}</code></td>
      <td data-label="Status"><span class="badge st-${a.status}">${STATUS_LABEL[a.status]}</span>${problems.has(a.id) ? ` <span class="badge expired">Rule problem</span>` : ''}</td>
      <td data-label=""><button type="button" class="ghost small" data-edit="${a.id}">Edit<span class="sr-only"> ${esc(a.reference)}</span></button></td>
    </tr>`).join('');

  $<HTMLSelectElement>('buffer').value = String(rules.bufferMin);
  if (focusId) grid.querySelector<HTMLElement>(`.appt[data-id="${focusId}"]`)?.focus();
}

function persist(): void {
  edited = true;
  saveSchedule(localStorage, schedule, rules.bufferMin);
}

let msgTimer: number | undefined;
function say(text: string, kind: 'ok' | 'error' = 'ok'): void {
  const m = $('msg');
  m.textContent = text;
  m.className = `msg ${kind}`;
  window.clearTimeout(msgTimer);
  if (kind === 'ok') msgTimer = window.setTimeout(() => { m.textContent = ''; m.className = 'msg'; }, 5000);
}

/** Saves a changed booking if it passes every check; otherwise reports why and keeps the old one. */
function tryUpdate(next: Appointment, focus = false): boolean {
  const problems = checkAppointment(next, schedule.appointments, docks, rules);
  if (problems.length) {
    say(`Not saved. ${problems.map((p) => p.message).join(' ')}`, 'error');
    render(focus ? next.id : undefined);
    return false;
  }
  schedule = { ...schedule, appointments: schedule.appointments.map((a) => (a.id === next.id ? next : a)) };
  persist();
  render(focus ? next.id : undefined);
  say(`Saved ${next.reference}: ${next.dockId}, ${toHHMM(next.start)} to ${toHHMM(next.end)}.`);
  return true;
}

function nextId(): string {
  const n = schedule.appointments.reduce((m, a) => Math.max(m, Number(a.id.replace(/\D/g, '')) || 0), 0) + 1;
  return `APT-${String(n).padStart(3, '0')}`;
}

// ---- booking form (keyboard, touch and screen reader path for everything the drag does) ----
const form = $<HTMLFormElement>('booking-form');
const f = {
  direction: $<HTMLSelectElement>('f-direction'), dock: $<HTMLSelectElement>('f-dock'),
  carrier: $<HTMLSelectElement>('f-carrier'), start: $<HTMLInputElement>('f-start'), end: $<HTMLInputElement>('f-end'),
  reference: $<HTMLInputElement>('f-ref'), trailer: $<HTMLInputElement>('f-trailer'), status: $<HTMLSelectElement>('f-status'),
};
let editingId: string | null = null;

function syncRefLabel(): void {
  $('f-ref-label').textContent = f.direction.value === 'inbound' ? 'PO number' : 'Load number';
}

function openForm(a: Partial<Appointment>, existing: boolean): void {
  editingId = existing ? a.id! : null;
  $('booking-title').textContent = existing ? `Edit booking ${a.reference}` : 'New booking';
  const dock = dockById.get(a.dockId ?? '') ?? docks[0];
  f.direction.value = a.direction ?? dock.kind;
  f.dock.value = dock.id;
  f.carrier.value = a.carrier ?? '';
  f.start.value = toHHMM(a.start ?? 8 * 60);
  f.end.value = toHHMM(a.end ?? (a.start ?? 8 * 60) + 60);
  f.reference.value = a.reference ?? '';
  f.trailer.value = a.trailer ?? '';
  f.status.value = a.status ?? 'booked';
  syncRefLabel();
  showErrors([]);
  $('f-delete').hidden = !existing;
  $('booking').hidden = false;
  $('booking').scrollIntoView?.({ block: 'nearest' });
  (existing ? f.dock : f.carrier).focus();
}

function closeForm(): void {
  $('booking').hidden = true;
  const id = editingId;
  editingId = null;
  if (id) grid.querySelector<HTMLElement>(`.appt[data-id="${id}"]`)?.focus();
}

const FIELD_FOR: Record<string, (keyof typeof f)[]> = {
  'bad-range': ['start', 'end'], 'outside-hours': ['start', 'end'], 'off-grid': ['start', 'end'],
  overlap: ['start', 'end', 'dock'], buffer: ['start', 'end', 'dock'], 'wrong-dock-kind': ['dock', 'direction'], 'unknown-dock': ['dock'],
};

function showErrors(problems: Conflict[]): void {
  $('form-errors').innerHTML = problems.map((p) => `<li data-code="${p.code}">${esc(p.message)}</li>`).join('');
  const bad = new Set<string>();
  for (const p of problems) {
    if (p.code === 'missing-field') bad.add(p.message.startsWith('Pick a carrier') ? 'carrier' : 'reference');
    else (FIELD_FOR[p.code] ?? []).forEach((k) => bad.add(k));
  }
  (Object.keys(f) as (keyof typeof f)[]).forEach((k) => {
    if (bad.has(k)) f[k].setAttribute('aria-invalid', 'true');
    else f[k].removeAttribute('aria-invalid');
  });
}

function readForm(): Appointment {
  return {
    id: editingId ?? nextId(),
    dockId: f.dock.value,
    carrier: f.carrier.value,
    direction: f.direction.value as DockKind,
    start: fromHHMM(f.start.value),
    end: fromHHMM(f.end.value),
    reference: f.reference.value.trim(),
    trailer: f.trailer.value.trim(),
    status: f.status.value as AppointmentStatus,
  };
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const appt = readForm();
  if (Number.isNaN(appt.start) || Number.isNaN(appt.end)) {
    showErrors([{ code: 'bad-range', message: 'Enter a start and end time.' }]);
    return;
  }
  const problems = checkAppointment(appt, schedule.appointments, docks, rules);
  showErrors(problems);
  if (problems.length) return;
  schedule = {
    ...schedule,
    appointments: editingId
      ? schedule.appointments.map((a) => (a.id === appt.id ? appt : a))
      : [...schedule.appointments, appt],
  };
  persist();
  closeForm();
  render(appt.id);
  say(`Saved ${appt.reference}: ${appt.dockId}, ${toHHMM(appt.start)} to ${toHHMM(appt.end)}.`);
});
f.direction.addEventListener('change', syncRefLabel);
$('f-cancel').addEventListener('click', closeForm);
$('f-delete').addEventListener('click', () => {
  const a = schedule.appointments.find((x) => x.id === editingId);
  if (!a) return;
  schedule = { ...schedule, appointments: schedule.appointments.filter((x) => x.id !== a.id) };
  editingId = null;
  persist();
  closeForm();
  render();
  say(`Deleted ${a.reference}.`);
});
form.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeForm(); });

$('new-booking').addEventListener('click', () => openForm({ dockId: 'IN-1', direction: 'inbound', start: 8 * 60, end: 9 * 60 }, false));
$('reset-seed').addEventListener('click', () => {
  schedule = seeded();
  rules = { ...rules, bufferMin: 0 };
  edited = false;
  clearSchedule(localStorage);
  $('booking').hidden = true;
  editingId = null;
  render();
  say('Schedule reset to the seeded day.');
});
$<HTMLSelectElement>('buffer').addEventListener('change', (e) => {
  rules = { ...rules, bufferMin: Number((e.target as HTMLSelectElement).value) };
  saveSchedule(localStorage, schedule, rules.bufferMin);
  render();
  const n = checkSchedule(schedule.appointments, docks, rules).size;
  say(rules.bufferMin
    ? `New bookings now need ${rules.bufferMin} minutes clear on each side. ${n} existing booking${n === 1 ? '' : 's'} break this rule.`
    : 'Buffer turned off.');
});
$('agenda-body').addEventListener('click', (e) => {
  const id = (e.target as HTMLElement).closest<HTMLElement>('[data-edit]')?.dataset.edit;
  const a = schedule.appointments.find((x) => x.id === id);
  if (a) openForm(a, true);
});

// ---- pointer: drag to create, move and resize ----
type Drag =
  | { mode: 'create'; dock: Dock; anchor: number; ghost: HTMLElement; start: number; end: number; x0: number; y0: number; moved: boolean }
  | { mode: 'move' | 'resize-start' | 'resize-end'; appt: Appointment; el: HTMLElement; offset: number; next: Appointment; x0: number; y0: number; moved: boolean };
let drag: Drag | null = null;
let suppressClick = false;

function laneX(lane: HTMLElement, clientX: number): { x: number; w: number } {
  const r = lane.getBoundingClientRect();
  return { x: clientX - r.left, w: r.width || 1 };
}

function laneAt(clientX: number, clientY: number): HTMLElement | null {
  const el = document.elementFromPoint?.(clientX, clientY) as HTMLElement | null;
  return el?.closest<HTMLElement>('.lane') ?? null;
}

grid.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const target = e.target as HTMLElement;
  const apptEl = target.closest<HTMLElement>('.appt');
  const lane = target.closest<HTMLElement>('.lane');
  if (!lane) return;
  const { x, w } = laneX(lane, e.clientX);
  if (apptEl) {
    const appt = schedule.appointments.find((a) => a.id === apptEl.dataset.id);
    if (!appt) return;
    const handle = target.dataset.handle;
    const mode = handle === 'start' ? 'resize-start' : handle === 'end' ? 'resize-end' : 'move';
    drag = { mode, appt, el: apptEl, offset: xToMinute(x, w, rules) - appt.start, next: { ...appt }, x0: e.clientX, y0: e.clientY, moved: false };
    apptEl.classList.add('dragging');
  } else {
    const dock = dockById.get(lane.dataset.dock!)!;
    const start = xToSlotStart(x, w, rules);
    const ghost = document.createElement('div');
    ghost.className = `draft ${dock.kind}`;
    ghost.setAttribute('aria-hidden', 'true');
    place(ghost, start, start + rules.slot);
    lane.appendChild(ghost);
    drag = { mode: 'create', dock, anchor: start, ghost, start, end: start + rules.slot, x0: e.clientX, y0: e.clientY, moved: false };
  }
  grid.setPointerCapture?.(e.pointerId);
});

function geometryProblems(a: Appointment): Conflict[] {
  return checkAppointment({ ...a, carrier: a.carrier || 'x', reference: a.reference || 'x' }, schedule.appointments, docks, rules);
}

grid.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) > 4) drag.moved = true;
  if (!drag.moved) return;
  if (drag.mode === 'create') {
    const lane = lanes.get(drag.dock.id)!;
    const { x, w } = laneX(lane, e.clientX);
    const cur = xToSlotStart(x, w, rules);
    drag.start = Math.min(drag.anchor, cur);
    drag.end = Math.max(drag.anchor, cur) + rules.slot;
    place(drag.ghost, drag.start, drag.end);
    const bad = geometryProblems({ id: '__new', dockId: drag.dock.id, direction: drag.dock.kind, carrier: '', reference: '', trailer: '', status: 'booked', start: drag.start, end: drag.end });
    drag.ghost.classList.toggle('invalid', bad.length > 0);
    drag.ghost.textContent = `${toHHMM(drag.start)} to ${toHHMM(drag.end)}`;
    return;
  }
  const { appt } = drag;
  let lane = lanes.get(drag.next.dockId)!;
  if (drag.mode === 'move') {
    const over = laneAt(e.clientX, e.clientY);
    if (over && over !== lane) { lane = over; lane.appendChild(drag.el); }
  }
  const { x, w } = laneX(lane, e.clientX);
  const m = xToMinute(x, w, rules);
  const len = appt.end - appt.start;
  let { start, end } = appt;
  if (drag.mode === 'move') {
    start = Math.max(rules.open, Math.min(rules.close - len, m - drag.offset));
    end = start + len;
  } else if (drag.mode === 'resize-start') {
    start = Math.min(m, appt.end - rules.slot);
  } else {
    end = Math.max(m, appt.start + rules.slot);
  }
  drag.next = { ...appt, dockId: lane.dataset.dock!, start, end };
  place(drag.el, start, end);
  drag.el.classList.toggle('invalid', geometryProblems(drag.next).length > 0);
});

function endDrag(cancelled: boolean): void {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (d.mode === 'create') {
    d.ghost.remove();
    if (cancelled) return;
    const draft: Appointment = { id: '__new', dockId: d.dock.id, direction: d.dock.kind, carrier: '', reference: '', trailer: '', status: 'booked', start: d.start, end: d.end };
    const bad = geometryProblems(draft);
    if (bad.length) { say(`Can't book there. ${bad.map((p) => p.message).join(' ')}`, 'error'); return; }
    openForm({ dockId: d.dock.id, direction: d.dock.kind, start: d.start, end: d.end }, false);
    return;
  }
  d.el.classList.remove('dragging', 'invalid');
  if (!d.moved) return; // a plain click opens the form through the click handler
  suppressClick = true;
  const n = d.next;
  if (cancelled || (n.dockId === d.appt.dockId && n.start === d.appt.start && n.end === d.appt.end)) { render(); return; }
  tryUpdate(n);
}

grid.addEventListener('pointerup', () => endDrag(false));
grid.addEventListener('pointercancel', () => endDrag(true));

grid.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('.appt');
  if (!el) return;
  if (suppressClick) { suppressClick = false; return; }
  const a = schedule.appointments.find((x) => x.id === el.dataset.id);
  if (a) openForm(a, true);
});

// ---- keyboard on a focused booking ----
grid.addEventListener('keydown', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('.appt');
  if (!el) return;
  const a = schedule.appointments.find((x) => x.id === el.dataset.id);
  if (!a) return;
  const step = rules.slot;
  let next: Appointment | null = null;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const dir = e.key === 'ArrowLeft' ? -1 : 1;
    next = e.shiftKey ? { ...a, end: a.end + dir * step } : { ...a, start: a.start + dir * step, end: a.end + dir * step };
  } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    const same = docks.filter((d) => d.kind === dockById.get(a.dockId)?.kind);
    const i = same.findIndex((d) => d.id === a.dockId) + (e.key === 'ArrowUp' ? -1 : 1);
    if (i < 0 || i >= same.length) { e.preventDefault(); return; }
    next = { ...a, dockId: same[i].id };
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    openForm(a, true);
    e.preventDefault();
    return;
  }
  if (!next) return;
  e.preventDefault();
  tryUpdate(next, true);
});

render();
