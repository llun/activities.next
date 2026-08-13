import { FitnessGearKind } from '@/lib/services/fitness-files/sportTypes'

export type { FitnessGearKind }

// SQL row type for the fitness_gears table. Timestamps and floats are loose
// because the two backends hand them back differently: SQLite stores timestamps
// as epoch-millisecond integers and can return numerics as strings, PostgreSQL
// returns Date objects and (for some paths) numeric strings.
export interface SQLFitnessGear {
  id: string
  actorId: string
  kind: FitnessGearKind
  name: string
  brand?: string | null
  model?: string | null
  bikeType?: string | null
  weightKilograms?: number | string | null
  // JSON-encoded array of canonical sport keys.
  defaultSports?: string | null
  alertDistanceMeters?: number | string | null
  lastAlertedDistanceMeters?: number | string | null
  notes?: string | null
  retiredAt?: number | Date | string | null
  // Devices only: the immutable identity the recorded file carried, which
  // `resolveDeviceGear` matches an upload against. Unique per actor.
  deviceKey?: string | null
  productUrl?: string | null

  createdAt: number | Date
  updatedAt: number | Date
  deletedAt?: number | Date | string | null
}

// Parsed version for application use.
export interface FitnessGear {
  id: string
  actorId: string
  kind: FitnessGearKind
  name: string
  brand?: string
  model?: string
  bikeType?: string
  weightKilograms?: number
  defaultSports: string[]
  alertDistanceMeters?: number
  lastAlertedDistanceMeters?: number
  notes?: string
  retiredAt?: number
  deviceKey?: string
  productUrl?: string

  createdAt: number
  updatedAt: number
  deletedAt?: number
}

export interface SQLFitnessGearComponent {
  id: string
  gearId: string
  componentType: string
  brand?: string | null
  model?: string | null
  // null = installed since the gear's beginning.
  addedAt?: number | Date | string | null
  // null = still installed.
  removedAt?: number | Date | string | null
  serviceDistanceMeters?: number | string | null
  lastAlertedDistanceMeters?: number | string | null

  createdAt: number | Date
  updatedAt: number | Date
  deletedAt?: number | Date | string | null
}

export interface FitnessGearComponent {
  id: string
  gearId: string
  componentType: string
  brand?: string
  model?: string
  addedAt?: number
  removedAt?: number
  serviceDistanceMeters?: number
  lastAlertedDistanceMeters?: number

  createdAt: number
  updatedAt: number
  deletedAt?: number
}

/**
 * Distance and activity count derived from `fitness_files` — never stored. Gear
 * totals sum every activity attributed to the gear; component totals sum only
 * the activities inside the component's install window.
 */
export interface FitnessGearDistanceRollup {
  distanceMeters: number
  activityCount: number
}

/**
 * A device's rollup, derived the same way and over the same countable-activity
 * predicate as the distance rollups — but a device records rides and runs
 * alike, so summing their distances would report a number that means nothing.
 * What a device page shows instead is how many activities it captured and when
 * it first did, `firstUsedAt` being the MIN `activityStartTime` among them (null
 * when nothing is linked, or when every linked activity is timestamp-less).
 */
export interface FitnessGearDeviceRollup {
  activityCount: number
  firstUsedAt: number | null
}
