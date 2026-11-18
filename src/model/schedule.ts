import type { Appointment, Dock, DockRules } from './types';

/** Operating day for the dock doors: 06:00 to 22:00, 30-minute slots, no buffer by default. */
export const DEFAULT_RULES: DockRules = { open: 6 * 60, close: 22 * 60, slot: 30, bufferMin: 0 };

export const BUFFER_OPTIONS = [0, 15, 30] as const;

export type ConflictCode =
  | 'missing-field'
  | 'bad-range'
  | 'unknown-dock'
  | 'wrong-dock-kind'
  | 'outside-hours'
  | 'off-grid'
  | 'overlap'
  | 'buffer';

export interface Conflict {
  code: ConflictCode;
  message: string;
  /** The other booking involved, for overlap and buffer conflicts. */
  withId?: string;
}

export function toHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function fromHHMM(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Every slot boundary in the operating day, open and close included. */
export function slotTimes(rules: DockRules = DEFAULT_RULES): number[] {
  const out: number[] = [];
  for (let t = rules.open; t <= rules.close; t += rules.slot) out.push(t);
  return out;
}

/** Converts a pointer x position inside a lane to a snapped minute value. */
export function xToMinute(x: number, laneWidth: number, rules: DockRules = DEFAULT_RULES): number {
  const span = rules.close - rules.open;
  const raw = rules.open + (Math.max(0, Math.min(laneWidth, x)) / laneWidth) * span;
  const snapped = rules.open + Math.round((raw - rules.open) / rules.slot) * rules.slot;
  return Math.max(rules.open, Math.min(rules.close, snapped));
}

/** Same, but floors to the slot the pointer is in (used to start a drag-to-create). */
export function xToSlotStart(x: number, laneWidth: number, rules: DockRules = DEFAULT_RULES): number {
  const span = rules.close - rules.open;
  const raw = rules.open + (Math.max(0, Math.min(laneWidth - 1, x)) / laneWidth) * span;
  return rules.open + Math.floor((raw - rules.open) / rules.slot) * rules.slot;
}

/** Two half-open ranges [aStart, aEnd) and [bStart, bEnd) overlap. */
export function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Checks one booking against the rules and the other bookings.
 * `others` may contain the booking itself (same id); it is ignored.
 * Returns an empty list when the booking can be saved.
 */
export function checkAppointment(
  appt: Appointment,
  others: readonly Appointment[],
  docks: readonly Dock[],
  rules: DockRules = DEFAULT_RULES,
): Conflict[] {
  const problems: Conflict[] = [];
  if (!appt.carrier.trim()) problems.push({ code: 'missing-field', message: 'Pick a carrier.' });
  if (!appt.reference.trim()) {
    problems.push({ code: 'missing-field', message: `Enter a ${appt.direction === 'inbound' ? 'PO' : 'load'} reference.` });
  }

  if (!(appt.end > appt.start)) {
    problems.push({ code: 'bad-range', message: 'End time must be after the start time.' });
  }

  const dock = docks.find((d) => d.id === appt.dockId);
  if (!dock) {
    problems.push({ code: 'unknown-dock', message: `Door ${appt.dockId} does not exist.` });
  } else if (dock.kind !== appt.direction) {
    problems.push({
      code: 'wrong-dock-kind',
      message: appt.direction === 'inbound'
        ? `${dock.id} is an outbound door. Inbound receipts go on IN doors.`
        : `${dock.id} is an inbound door. Outbound loads go on OUT doors.`,
    });
  }

  if (appt.start < rules.open || appt.end > rules.close) {
    problems.push({
      code: 'outside-hours',
      message: `Docks run ${toHHMM(rules.open)} to ${toHHMM(rules.close)}. This booking is outside operating hours.`,
    });
  }

  if ((appt.start - rules.open) % rules.slot !== 0 || (appt.end - rules.open) % rules.slot !== 0) {
    problems.push({ code: 'off-grid', message: `Start and end must be on the ${rules.slot}-minute grid (for example 08:00 or 08:30).` });
  }

  if (appt.end > appt.start) {
    for (const o of others) {
      if (o.id === appt.id || o.dockId !== appt.dockId) continue;
      const when = `${toHHMM(o.start)} to ${toHHMM(o.end)}`;
      if (rangesOverlap(appt.start, appt.end, o.start, o.end)) {
        problems.push({ code: 'overlap', withId: o.id, message: `Overlaps ${o.carrier} (${o.reference}) on ${o.dockId}, ${when}.` });
      } else if (rules.bufferMin > 0 && rangesOverlap(appt.start - rules.bufferMin, appt.end + rules.bufferMin, o.start, o.end)) {
        problems.push({
          code: 'buffer', withId: o.id,
          message: `Needs ${rules.bufferMin} min clear before and after. Too close to ${o.carrier} (${o.reference}) on ${o.dockId}, ${when}.`,
        });
      }
    }
  }
  return problems;
}

/** Runs checkAppointment on every booking. Returns a map of id to problems (only ids with problems). */
export function checkSchedule(
  appts: readonly Appointment[],
  docks: readonly Dock[],
  rules: DockRules = DEFAULT_RULES,
): Map<string, Conflict[]> {
  const out = new Map<string, Conflict[]>();
  for (const a of appts) {
    const p = checkAppointment(a, appts, docks, rules);
    if (p.length) out.set(a.id, p);
  }
  return out;
}

/** Share of open dock-minutes that are booked, 0..1. */
export function utilisation(appts: readonly Appointment[], docks: readonly Dock[], rules: DockRules = DEFAULT_RULES): number {
  const capacity = docks.length * (rules.close - rules.open);
  const used = appts.reduce((n, a) => n + Math.max(0, Math.min(a.end, rules.close) - Math.max(a.start, rules.open)), 0);
  return capacity ? used / capacity : 0;
}
