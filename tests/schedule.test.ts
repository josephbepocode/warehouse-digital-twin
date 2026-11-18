import { generateWarehouse } from '../src/model/seed';
import { CARRIERS, generateAppointments } from '../src/model/docks';
import {
  checkAppointment, checkSchedule, DEFAULT_RULES, fromHHMM, rangesOverlap, toHHMM, utilisation, xToMinute, xToSlotStart,
} from '../src/model/schedule';
import { loadSchedule, saveSchedule, STORAGE_KEY } from '../src/model/storage';
import type { Appointment } from '../src/model/types';

const wh = generateWarehouse();
const docks = wh.docks;
const h = (s: string) => fromHHMM(s);

function appt(over: Partial<Appointment> = {}): Appointment {
  return {
    id: 'T1', dockId: 'IN-1', carrier: 'Quill River Freight', direction: 'inbound',
    start: h('08:00'), end: h('09:00'), reference: 'PO-1', trailer: 'TR-1', status: 'booked', ...over,
  };
}
const codes = (a: Appointment, others: Appointment[] = [], rules = DEFAULT_RULES) =>
  checkAppointment(a, others, docks, rules).map((c) => c.code);

describe('time helpers', () => {
  it('formats and parses HH:MM', () => {
    expect(toHHMM(6 * 60)).toBe('06:00');
    expect(toHHMM(21 * 60 + 30)).toBe('21:30');
    expect(fromHHMM('07:30')).toBe(450);
    expect(fromHHMM('nope')).toBeNaN();
  });

  it('snaps lane x positions to the 30-minute grid', () => {
    const w = 32 * 38; // 32 slots across 06:00 to 22:00
    expect(xToMinute(0, w)).toBe(h('06:00'));
    expect(xToMinute(w, w)).toBe(h('22:00'));
    expect(xToMinute(38 * 4 + 10, w)).toBe(h('08:00'));
    expect(xToMinute(38 * 4 + 25, w)).toBe(h('08:30'));
    expect(xToSlotStart(38 * 4 + 37, w)).toBe(h('08:00'));
    expect(xToMinute(-50, w)).toBe(h('06:00'));
    expect(xToSlotStart(w + 50, w)).toBe(h('21:30'));
  });

  it('treats touching ranges as not overlapping', () => {
    expect(rangesOverlap(0, 60, 60, 120)).toBe(false);
    expect(rangesOverlap(0, 61, 60, 120)).toBe(true);
  });
});

describe('checkAppointment', () => {
  it('accepts a valid booking', () => {
    expect(codes(appt())).toEqual([]);
  });

  it('blocks overlapping bookings on the same door', () => {
    const other = appt({ id: 'T2', start: h('08:30'), end: h('10:00'), reference: 'PO-2' });
    const problems = checkAppointment(appt(), [other], docks);
    expect(problems.map((p) => p.code)).toEqual(['overlap']);
    expect(problems[0].withId).toBe('T2');
    expect(problems[0].message).toContain('PO-2');
  });

  it('allows the same time on a different door, and back-to-back on the same door', () => {
    expect(codes(appt(), [appt({ id: 'T2', dockId: 'IN-2' })])).toEqual([]);
    expect(codes(appt(), [appt({ id: 'T2', start: h('09:00'), end: h('10:00') })])).toEqual([]);
  });

  it('ignores itself when checking an edit', () => {
    const a = appt();
    expect(codes({ ...a, end: h('10:00') }, [a])).toEqual([]);
  });

  it('keeps inbound on inbound doors and outbound on outbound doors', () => {
    expect(codes(appt({ dockId: 'OUT-1' }))).toEqual(['wrong-dock-kind']);
    expect(codes(appt({ direction: 'outbound', dockId: 'IN-3', reference: 'LD-1' }))).toEqual(['wrong-dock-kind']);
    expect(codes(appt({ direction: 'outbound', dockId: 'OUT-3', reference: 'LD-1' }))).toEqual([]);
  });

  it('enforces operating hours', () => {
    expect(codes(appt({ start: h('05:30'), end: h('06:30') }))).toEqual(['outside-hours']);
    expect(codes(appt({ start: h('21:30'), end: h('22:30') }))).toEqual(['outside-hours']);
    expect(codes(appt({ start: h('21:00'), end: h('22:00') }))).toEqual([]);
  });

  it('enforces the optional buffer only when it is set', () => {
    const before = appt({ id: 'T0', start: h('07:00'), end: h('08:00'), reference: 'PO-0' });
    expect(codes(appt(), [before])).toEqual([]);
    expect(codes(appt(), [before], { ...DEFAULT_RULES, bufferMin: 30 })).toEqual(['buffer']);
    const gap = appt({ id: 'T0', start: h('06:30'), end: h('07:30'), reference: 'PO-0' });
    expect(codes(appt(), [gap], { ...DEFAULT_RULES, bufferMin: 30 })).toEqual([]);
    expect(codes(appt(), [gap], { ...DEFAULT_RULES, bufferMin: 15 })).toEqual([]);
  });

  it('rejects empty, reversed and off-grid times, unknown doors and missing fields', () => {
    expect(codes(appt({ end: h('08:00') }))).toContain('bad-range');
    expect(codes(appt({ end: h('07:00') }))).toContain('bad-range');
    expect(codes(appt({ start: h('08:10') }))).toContain('off-grid');
    expect(codes(appt({ dockId: 'IN-99' }))).toContain('unknown-dock');
    expect(codes(appt({ carrier: '', reference: ' ' }))).toEqual(['missing-field', 'missing-field']);
  });
});

describe('seeded dock day', () => {
  it.each([1, 7, 99, 2026, 20261031])('has 35 to 49 inbound receipts and no conflicts (seed %i)', (seed) => {
    const w = generateWarehouse(seed);
    const s = generateAppointments(w);
    const inbound = s.appointments.filter((a) => a.direction === 'inbound');
    expect(inbound.length).toBeGreaterThanOrEqual(35);
    expect(inbound.length).toBeLessThanOrEqual(49);
    expect(s.appointments.length - inbound.length).toBeGreaterThanOrEqual(14);
    expect(checkSchedule(s.appointments, w.docks).size).toBe(0);
    expect(new Set(s.appointments.map((a) => a.id)).size).toBe(s.appointments.length);
    expect(new Set(s.appointments.map((a) => a.reference)).size).toBe(s.appointments.length);
  });

  it('is identical for the same seed and different for another seed', () => {
    expect(generateAppointments(generateWarehouse(5))).toEqual(generateAppointments(generateWarehouse(5)));
    expect(generateAppointments(generateWarehouse(5))).not.toEqual(generateAppointments(generateWarehouse(6)));
  });

  it('only uses the made-up carrier list and the seeded day', () => {
    const s = generateAppointments(wh);
    expect(s.date).toBe(wh.asOf);
    s.appointments.forEach((a) => expect(CARRIERS).toContain(a.carrier));
  });

  it('reports door utilisation between 0 and 1', () => {
    const s = generateAppointments(wh);
    const u = utilisation(s.appointments, docks);
    expect(u).toBeGreaterThan(0.2);
    expect(u).toBeLessThan(1);
  });
});

describe('storage', () => {
  function memory(): Storage {
    const m = new Map<string, string>();
    return {
      get length() { return m.size; }, clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null,
      getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k),
    };
  }

  it('round-trips bookings and the buffer setting', () => {
    const st = memory();
    const s = generateAppointments(wh);
    saveSchedule(st, s, 15);
    expect(loadSchedule(st, wh.seed, wh.asOf)).toEqual({ schedule: s, bufferMin: 15 });
  });

  it('ignores data for another seed or broken data', () => {
    const st = memory();
    saveSchedule(st, generateAppointments(wh), 0);
    expect(loadSchedule(st, 123, wh.asOf)).toBeNull();
    st.setItem(STORAGE_KEY, '{not json');
    expect(loadSchedule(st, wh.seed, wh.asOf)).toBeNull();
    st.setItem(STORAGE_KEY, JSON.stringify({ seed: wh.seed, date: wh.asOf, bufferMin: 0, appointments: [{ id: 1 }] }));
    expect(loadSchedule(st, wh.seed, wh.asOf)).toBeNull();
  });
});
