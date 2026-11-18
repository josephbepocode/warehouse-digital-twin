import { BUFFER_OPTIONS } from './schedule';
import type { Appointment, DockSchedule } from './types';

export const STORAGE_KEY = 'wop.docks.v1';

interface Saved { seed: number; date: string; bufferMin: number; appointments: Appointment[] }

function isAppointment(a: unknown): a is Appointment {
  if (!a || typeof a !== 'object') return false;
  const o = a as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.dockId === 'string' && typeof o.carrier === 'string'
    && (o.direction === 'inbound' || o.direction === 'outbound')
    && Number.isFinite(o.start) && Number.isFinite(o.end)
    && typeof o.reference === 'string' && typeof o.trailer === 'string' && typeof o.status === 'string';
}

/** Loads saved bookings for this seed and day, or null when nothing valid is stored. */
export function loadSchedule(storage: Storage, seed: number, date: string): { schedule: DockSchedule; bufferMin: number } | null {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Saved;
    if (s.seed !== seed || s.date !== date || !Array.isArray(s.appointments) || !s.appointments.every(isAppointment)) return null;
    const bufferMin = (BUFFER_OPTIONS as readonly number[]).includes(s.bufferMin) ? s.bufferMin : 0;
    return { schedule: { seed, date, appointments: s.appointments }, bufferMin };
  } catch {
    return null;
  }
}

export function saveSchedule(storage: Storage, schedule: DockSchedule, bufferMin: number): void {
  const data: Saved = { seed: schedule.seed, date: schedule.date, bufferMin, appointments: schedule.appointments };
  try { storage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* storage full or blocked: keep working in memory */ }
}

export function clearSchedule(storage: Storage): void {
  try { storage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}
