import { createRng } from './rng';
import { checkAppointment, DEFAULT_RULES } from './schedule';
import type { Appointment, AppointmentStatus, Dock, DockKind, DockRules, DockSchedule, Warehouse } from './types';

/** Made-up carrier names. None of these are real companies. */
export const CARRIERS = [
  'Quill River Freight',
  'Tamarack Cartage',
  'Owlhead Transport',
  'Brindle Lane Logistics',
  'Copperfen Haulage',
  'Lantern Bay Freightways',
  'Stonemoss Carriers',
  'Halcyon Ridge Express',
] as const;

export const STATUSES: AppointmentStatus[] = ['booked', 'checked-in', 'in-progress', 'done', 'late'];

/** Simulated "now" on the seeded day, used only to give seeded bookings a believable status. */
export const SEED_CLOCK = 11 * 60;

const DURATIONS: Record<DockKind, number[]> = {
  // Most receipts take an hour; some floor-loaded trailers take longer.
  inbound: [60, 60, 60, 90, 90, 30, 120],
  outbound: [60, 90, 90, 120],
};

function statusFor(start: number, end: number, roll: number): AppointmentStatus {
  if (end <= SEED_CLOCK) return 'done';
  if (start <= SEED_CLOCK) return 'in-progress';
  if (start - SEED_CLOCK <= 60) return roll < 0.35 ? 'checked-in' : roll < 0.5 ? 'late' : 'booked';
  return 'booked';
}

/**
 * Builds a realistic day at the doors from the warehouse seed: 35 to 49 inbound receipts
 * across the 6 inbound doors and 14 to 20 outbound loads on the 6 outbound doors.
 * Every seeded booking passes the conflict checks with the default rules.
 */
export function generateAppointments(wh: Pick<Warehouse, 'seed' | 'asOf' | 'docks'>, rules: DockRules = DEFAULT_RULES): DockSchedule {
  const rng = createRng((wh.seed ^ 0x0d0c5) >>> 0);
  const appointments: Appointment[] = [];
  const targets: Record<DockKind, number> = { inbound: rng.int(35, 49), outbound: rng.int(14, 20) };
  let po = 450000 + rng.int(0, 9999);
  let load = 81000 + rng.int(0, 999);

  for (const kind of ['inbound', 'outbound'] as DockKind[]) {
    const doors = wh.docks.filter((d: Dock) => d.kind === kind);
    let placed = 0;
    for (let attempt = 0; placed < targets[kind] && attempt < 5000; attempt++) {
      const dock = rng.pick(doors);
      const duration = rng.pick(DURATIONS[kind]);
      const slots = (rules.close - rules.open - duration) / rules.slot;
      const start = rules.open + rng.int(0, slots) * rules.slot;
      const appt: Appointment = {
        id: '',
        dockId: dock.id,
        carrier: rng.pick(CARRIERS),
        direction: kind,
        start,
        end: start + duration,
        reference: '',
        trailer: `TR-${rng.int(1000, 9899)}`,
        status: statusFor(start, start + duration, rng.next()),
      };
      if (checkAppointment({ ...appt, id: '__draft', reference: 'x' }, appointments, wh.docks, rules).length) continue;
      appt.reference = kind === 'inbound' ? `PO-${po++}` : `LD-${load++}`;
      appointments.push(appt);
      placed++;
    }
  }

  appointments.sort((a, b) => a.start - b.start || a.dockId.localeCompare(b.dockId, 'en', { numeric: true }));
  appointments.forEach((a, i) => (a.id = `APT-${String(i + 1).padStart(3, '0')}`));
  return { seed: wh.seed, date: wh.asOf, appointments };
}
