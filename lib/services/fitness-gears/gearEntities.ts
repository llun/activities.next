import {
  FitnessGear,
  FitnessGearComponent,
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

export const toGearEntity = (
  gear: FitnessGear,
  rollup: FitnessGearDistanceRollup = EMPTY_ROLLUP
): GearEntity => ({
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
  distanceMeters: rollup.distanceMeters,
  activityCount: rollup.activityCount
})

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
