import { FitnessGearKind } from '@/lib/services/fitness-files/sportTypes'

export type { FitnessGearKind }

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
  // Devices only: the immutable identity the recorded file carried, which
  // `resolveDeviceGear` matches an upload against. Unique per actor.
  deviceKey?: string
  productUrl?: string

  createdAt: number
  updatedAt: number
  deletedAt?: number
}

/**
 * One stretch during which a component was fitted to its gear. A part that
 * comes off and goes back on — a wheelset put away for the winter, or a
 * retirement undone months later — gets a second row rather than having its
 * original window reopened, which is what used to credit it every activity
 * ridden while it was off the bike.
 *
 * `installSequence` is the ordering key rather than `addedAt`: the first
 * period's `addedAt` is nullable ("since the gear's beginning") and the
 * backends disagree on where NULLs sort. It is UNIQUE with `componentId`, which
 * is what stops two concurrent refits from both opening a period — two open
 * periods would make the rollup count every later activity twice.
 */
export interface FitnessGearComponentPeriod {
  id: string
  componentId: string
  installSequence: number
  addedAt?: number
  removedAt?: number

  createdAt: number
  updatedAt: number
}

/**
 * `addedAt` and `removedAt` are DERIVED from `periods` — the first period's
 * start and the last period's end — rather than stored on the component row.
 * They mean exactly what they always did (when the part first went on, and when
 * it last came off, null while it is fitted), so every reader that asks a
 * component those two questions is unaffected by the periods behind them.
 */
export interface FitnessGearComponent {
  id: string
  gearId: string
  componentType: string
  brand?: string
  model?: string
  addedAt?: number
  removedAt?: number
  // Oldest first. Never empty for a component this module created.
  periods: FitnessGearComponentPeriod[]
  serviceDistanceMeters?: number
  lastAlertedDistanceMeters?: number

  createdAt: number
  updatedAt: number
  deletedAt?: number
  productUrl?: string
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
