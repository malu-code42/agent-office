import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// The reservation of a squad folder. While the office writes a squad, the folder of
// that squad exists (it was taken with an exclusive mkdir) but it is not a squad yet.
// The marker below says so: a folder with the marker is a creation in progress, and
// the office never shows it as a squad (neither as available nor as broken).
//
// The marker is a file inside the folder of the squad and carries the id of the
// attempt that reserved it. That way a rollback only undoes what this attempt did:
// a folder reserved by somebody else is never touched.

/** The name of the marker file, inside the folder of the squad. */
export const RESERVATION_MARKER = '.reserva'

/** After this time without progress, a reservation is stale: the app was closed. */
export const RESERVATION_STALE_MS = 15 * 60 * 1000

/** What the marker of a folder says about it. */
export type ReservationState =
  /** Nobody reserved it: it is an ordinary folder (or a squad). */
  | 'none'
  /** A creation is running right now: the folder is not a squad yet. */
  | 'active'
  /** The creation was interrupted: the folder is half-made and needs the player. */
  | 'stale'
  /** The files were published and only the cleanup was lost: the squad is whole. */
  | 'complete'

/** The marker of a folder: the attempt that reserved it and when. */
export interface Reservation {
  /** The id of the attempt; only that attempt may undo the reservation. */
  attempt: string
  /** When the reservation was taken (ms). */
  at: number
}

const readMarker = (dir: string): Reservation | undefined => {
  try {
    const raw = JSON.parse(readFileSync(join(dir, RESERVATION_MARKER), 'utf8')) as unknown
    if (!raw || typeof raw !== 'object') return undefined
    const r = raw as Record<string, unknown>
    if (typeof r.attempt !== 'string' || !r.attempt) return undefined
    const at = typeof r.at === 'number' && Number.isFinite(r.at) ? r.at : 0
    return { attempt: r.attempt, at }
  } catch {
    // A marker that cannot be read is still a marker: the folder is reserved.
    return { attempt: '', at: 0 }
  }
}

/**
 * The state of the reservation of a folder. A folder with the marker and with the
 * squad.yaml is a squad whose cleanup was lost: it is whole and can be recovered.
 */
export function reservationState(dir: string, now = Date.now()): ReservationState {
  if (!existsSync(join(dir, RESERVATION_MARKER))) return 'none'
  if (existsSync(join(dir, 'squad.yaml'))) return 'complete'
  const marker = readMarker(dir)
  if (!marker) return 'active'
  return now - marker.at >= RESERVATION_STALE_MS ? 'stale' : 'active'
}

/** Who reserved the folder; undefined when nobody did. */
export function reservationOf(dir: string): Reservation | undefined {
  if (!existsSync(join(dir, RESERVATION_MARKER))) return undefined
  return readMarker(dir)
}

/** Takes the reservation of a folder for this attempt. */
export function writeReservation(dir: string, attempt: string, now = Date.now()): void {
  writeFileSync(join(dir, RESERVATION_MARKER), JSON.stringify({ attempt, at: now }), 'utf8')
}

/**
 * Gives the reservation back: the folder stops being "in progress". The marker is
 * only removed when it still belongs to this attempt: a folder taken by somebody
 * else in the meantime keeps its own marker.
 */
export function clearReservation(dir: string, attempt?: string): void {
  const marker = reservationOf(dir)
  if (!marker) return
  if (attempt !== undefined && marker.attempt && marker.attempt !== attempt) return
  rmSync(join(dir, RESERVATION_MARKER), { force: true })
}

/**
 * A folder that only holds the marker of an interrupted creation: the office made
 * it and nothing else is in it. Such a folder can be removed safely: no data of the
 * player is in it. A folder with anything else inside is left alone.
 */
export function isAbandonedReservation(dir: string): boolean {
  if (!existsSync(join(dir, RESERVATION_MARKER))) return false
  try {
    return readdirSync(dir).every((name) => name === RESERVATION_MARKER)
  } catch {
    return false
  }
}
