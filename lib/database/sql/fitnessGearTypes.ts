import { FitnessGearKind } from '@/lib/services/fitness-files/sportTypes'
import {
  FitnessGear,
  FitnessGearComponent,
  FitnessGearDeviceRollup,
  FitnessGearDistanceRollup
} from '@/lib/types/database/fitnessGear'

/**
 * One row of a gear's activity list — the identity of the activity and of the
 * post it was published as, and nothing else.
 *
 * Deliberately this narrow because a gear's page renders the POST, not the row:
 * the route hands `statusId` to `getStatusesByIds` and pages on the row count.
 * Everything the old compact list needed (`fileName`, `description`,
 * `activityType`, the distance, and the `statuses` join behind `publicId`) came
 * off the query with it, since each of those was paid on every page of a
 * history that can run to five figures.
 *
 * `statusId` is null for an activity that was never posted, or whose post has
 * since been deleted — deleting a status only nulls the column, leaving a row
 * that still counts toward the gear's totals with no post left to render.
 */
export interface FitnessGearActivity {
  id: string
  statusId: string | null
}

export interface CreateFitnessGearParams {
  actorId: string
  kind: FitnessGearKind
  name: string
  brand?: string | null
  model?: string | null
  bikeType?: string | null
  weightKilograms?: number | null
  defaultSports?: string[]
  alertDistanceMeters?: number | null
  notes?: string | null
  // Create-only, like `kind`: `deviceKey` is the identity every later upload
  // matches against, so rewriting it would fork the device's own history.
  deviceKey?: string | null
  // Every kind may carry one. A device's is seeded here from the brand map by
  // `resolveDeviceGear`; a bike's or a pair of shoes' comes from the gear form.
  productUrl?: string | null
}

// Every optional field uses presence semantics (`'field' in params`): absent
// leaves the column alone, an explicit null clears it.
export interface UpdateFitnessGearParams {
  id: string
  actorId: string
  name?: string
  brand?: string | null
  model?: string | null
  bikeType?: string | null
  weightKilograms?: number | null
  defaultSports?: string[]
  alertDistanceMeters?: number | null
  notes?: string | null
  productUrl?: string | null
}

export interface CreateFitnessGearComponentParams {
  gearId: string
  actorId: string
  componentType: string
  brand?: string | null
  model?: string | null
  // Seeds the component's FIRST install period. Neither is a column on the
  // component itself any more; a component always has at least one period.
  addedAt?: Date | null
  removedAt?: Date | null
  serviceDistanceMeters?: number | null
}

// `addedAt` and `removedAt` no longer name columns on the component: `addedAt`
// moves the FIRST period's start and `removedAt` the LAST period's end, which
// is exactly what those two have always meant for the component as a whole.
// Only the outermost bounds are reachable this way, so an edit cannot make two
// periods OVERLAP. Keeping each period's own `addedAt < removedAt` is what
// keeps it from inverting one instead, and that is the ROUTE's job — it is the
// layer that can see both ends of the period each bound lands on, which the
// component's derived pair does not describe once a part has been refitted.
export interface UpdateFitnessGearComponentParams {
  id: string
  gearId: string
  actorId: string
  componentType?: string
  brand?: string | null
  model?: string | null
  addedAt?: Date | null
  removedAt?: Date | null
  serviceDistanceMeters?: number | null
}

export interface FitnessGearComponentsDatabase {
  createFitnessGearComponent(
    params: CreateFitnessGearComponentParams
  ): Promise<FitnessGearComponent | null>
  getFitnessGearComponents(params: {
    gearId: string
    actorId: string
  }): Promise<FitnessGearComponent[]>
  updateFitnessGearComponent(
    params: UpdateFitnessGearComponentParams
  ): Promise<FitnessGearComponent | null>
  deleteFitnessGearComponent(params: {
    id: string
    gearId: string
    actorId: string
  }): Promise<boolean>
  retireFitnessGearComponent(params: {
    id: string
    gearId: string
    actorId: string
  }): Promise<FitnessGearComponent | null>
  /**
   * Puts a retired part back on the bike by opening a NEW install period at
   * today, leaving the closed one exactly as it is.
   *
   * Not the mirror of retiring, and deliberately not "reopen the window that
   * was closed": reopening credits the part every activity ridden while it was
   * off, and re-retiring cannot take that back. A new period costs at most the
   * gap between the retirement and the refit, which is seconds for a misclick
   * and is the truth for a genuine refit.
   *
   * Null when the part is already fitted, which is the same answer retiring
   * gives for a part already retired.
   */
  refitFitnessGearComponent(params: {
    id: string
    gearId: string
    actorId: string
  }): Promise<FitnessGearComponent | null>
  getFitnessGearComponentDistanceRollups(params: {
    actorId: string
    gearIds: string[]
  }): Promise<Record<string, FitnessGearDistanceRollup>>
  setFitnessGearComponentLastAlertedDistance(params: {
    id: string
    lastAlertedDistanceMeters: number | null
    // When set, the write only lands if no alert has been recorded at or above
    // this threshold — so the database, not a prior read, decides which of two
    // concurrent evaluations owns the crossing. Returns false when it loses.
    onlyIfBelowThresholdMeters?: number
  }): Promise<boolean>
}

export type FitnessGearComponentDatabase = FitnessGearComponentsDatabase

export interface FitnessGearBaseDatabase {
  createFitnessGear(params: CreateFitnessGearParams): Promise<FitnessGear>
  getFitnessGear(params: {
    id: string
    actorId: string
  }): Promise<FitnessGear | null>
  getFitnessGearsByActor(params: { actorId: string }): Promise<FitnessGear[]>
  getFitnessGearNamesByIds(params: {
    ids: string[]
  }): Promise<Record<string, string>>
  updateFitnessGear(
    params: UpdateFitnessGearParams
  ): Promise<FitnessGear | null>
  setFitnessGearRetired(params: {
    id: string
    actorId: string
    retired: boolean
  }): Promise<FitnessGear | null>
  deleteFitnessGear(params: { id: string; actorId: string }): Promise<boolean>
  getFitnessGearDistanceRollups(params: {
    actorId: string
    gearIds: string[]
  }): Promise<Record<string, FitnessGearDistanceRollup>>
  getFitnessGearDeviceRollups(params: {
    actorId: string
    gearIds: string[]
  }): Promise<Record<string, FitnessGearDeviceRollup>>
  getFitnessGearActivities(params: {
    actorId: string
    gearId: string
    kind: FitnessGearKind
    limit: number
    offset?: number
  }): Promise<FitnessGearActivity[]>
  findFitnessGearByDeviceKey(params: {
    actorId: string
    deviceKey: string
  }): Promise<FitnessGear | null>
  findFitnessGearByDefaultSport(params: {
    actorId: string
    sportKey: string
  }): Promise<FitnessGear | null>
  findFitnessGearByName(params: {
    actorId: string
    name: string
  }): Promise<FitnessGear | null>
  setFitnessGearLastAlertedDistance(params: {
    id: string
    lastAlertedDistanceMeters: number | null
    // When set, the write only lands if no alert has been recorded at or above
    // this threshold — so the database, not a prior read, decides which of two
    // concurrent evaluations owns the crossing. Returns false when it loses.
    onlyIfBelowThresholdMeters?: number
  }): Promise<boolean>

  setFitnessFileGear(params: {
    fitnessFileId: string
    actorId: string
    gearId: string | null
  }): Promise<{ id: string; gearId: string | null } | null>
  assignFitnessFileGearIfUnset(params: {
    fitnessFileId: string
    actorId: string
    gearId: string
  }): Promise<boolean>
}

export type FitnessGearDatabase = FitnessGearBaseDatabase &
  FitnessGearComponentsDatabase
