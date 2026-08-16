import {
  FitnessGear,
  FitnessGearComponent,
  FitnessGearDeviceRollup,
  FitnessGearDistanceRollup,
  FitnessGearKind
} from '@/lib/types/database/fitnessGear'

const EMPTY_ROLLUP: FitnessGearDistanceRollup = {
  distanceMeters: 0,
  activityCount: 0
}

/**
 * Gear as the web client consumes it. `distanceMeters` and `activityCount` are
 * derived per request from `fitness_files` rather than stored, so they are
 * always consistent with the activity record.
 */
export interface GearEntity {
  id: string
  kind: FitnessGearKind
  name: string
  brand: string | null
  model: string | null
  bikeType: string | null
  weightKilograms: number | null
  defaultSports: string[]
  alertDistanceMeters: number | null
  notes: string | null
  retiredAt: number | null
  createdAt: number
  distanceMeters: number
  activityCount: number
  /**
   * The manufacturer's page for this gear, linked from its own page. A device's
   * is seeded from the brand map when the import creates the row; a bike's or a
   * pair of shoes' is whatever the owner typed into the gear form.
   */
  productUrl: string | null
  /**
   * Devices only — the earliest `activityStartTime` among the activities this
   * device recorded. Bikes and shoes report null: they show a lifetime distance
   * instead, and "added" (`createdAt`) already answers when they joined the shed.
   */
  firstUsedAt: number | null
}

export interface GearComponentEntity {
  id: string
  gearId: string
  componentType: string
  brand: string | null
  model: string | null
  addedAt: number | null
  removedAt: number | null
  serviceDistanceMeters: number | null
  distanceMeters: number
  activityCount: number
}

/**
 * A device is rolled up differently — count and first-used rather than a
 * distance total, since summing a head unit's rides and runs together would
 * produce a number that means nothing. Passing the device rollup for a device
 * and the distance rollup for everything else keeps one entity shape for the
 * client while each kind reports what it actually has.
 */
export const toGearEntity = (
  gear: FitnessGear,
  rollup: FitnessGearDistanceRollup | FitnessGearDeviceRollup = EMPTY_ROLLUP
): GearEntity => {
  const isDeviceRollup = 'firstUsedAt' in rollup

  return {
    id: gear.id,
    kind: gear.kind,
    name: gear.name,
    brand: gear.brand ?? null,
    model: gear.model ?? null,
    bikeType: gear.bikeType ?? null,
    weightKilograms: gear.weightKilograms ?? null,
    defaultSports: gear.defaultSports,
    alertDistanceMeters: gear.alertDistanceMeters ?? null,
    notes: gear.notes ?? null,
    retiredAt: gear.retiredAt ?? null,
    createdAt: gear.createdAt,
    distanceMeters: isDeviceRollup ? 0 : rollup.distanceMeters,
    activityCount: rollup.activityCount,
    productUrl: gear.productUrl ?? null,
    firstUsedAt: isDeviceRollup ? rollup.firstUsedAt : null
  }
}

export const toGearComponentEntity = (
  component: FitnessGearComponent,
  rollup: FitnessGearDistanceRollup = EMPTY_ROLLUP
): GearComponentEntity => ({
  id: component.id,
  gearId: component.gearId,
  componentType: component.componentType,
  brand: component.brand ?? null,
  model: component.model ?? null,
  addedAt: component.addedAt ?? null,
  removedAt: component.removedAt ?? null,
  serviceDistanceMeters: component.serviceDistanceMeters ?? null,
  distanceMeters: rollup.distanceMeters,
  activityCount: rollup.activityCount
})
