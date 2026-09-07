import { Knex } from 'knex'

import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  FitnessGear,
  FitnessGearComponent,
  FitnessGearComponentPeriod,
  SQLFitnessGear,
  SQLFitnessGearComponent,
  SQLFitnessGearComponentPeriod
} from '@/lib/types/database/fitnessGear'

export const normalizeOptionalNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return undefined
}

/**
 * `defaultSports` is written by this module as a JSON array of canonical sport
 * keys. A value that does not parse back to an array of strings is treated as
 * "no defaults" rather than throwing: the column only ever gates auto-assign,
 * so a corrupt value must not make the gear unreadable.
 */
export const parseDefaultSports = (value?: string | null): string[] => {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

export const parseSQLFitnessGear = (row: SQLFitnessGear): FitnessGear => ({
  id: row.id,
  actorId: row.actorId,
  kind: row.kind,
  name: row.name,
  brand: row.brand ?? undefined,
  model: row.model ?? undefined,
  bikeType: row.bikeType ?? undefined,
  weightKilograms: normalizeOptionalNumber(row.weightKilograms),
  defaultSports: parseDefaultSports(row.defaultSports),
  alertDistanceMeters: normalizeOptionalNumber(row.alertDistanceMeters),
  lastAlertedDistanceMeters: normalizeOptionalNumber(
    row.lastAlertedDistanceMeters
  ),
  notes: row.notes ?? undefined,
  deviceKey: row.deviceKey ?? undefined,
  productUrl: row.productUrl ?? undefined,
  retiredAt: row.retiredAt ? getCompatibleTime(row.retiredAt) : undefined,
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt),
  deletedAt: row.deletedAt ? getCompatibleTime(row.deletedAt) : undefined
})

export const parseSQLFitnessGearComponentPeriod = (
  row: SQLFitnessGearComponentPeriod
): FitnessGearComponentPeriod => ({
  id: row.id,
  componentId: row.componentId,
  // SQLite can hand an integer column back as a string; the sequence is used
  // for ordering and for computing the next one, so it has to be a number.
  installSequence: normalizeOptionalNumber(row.installSequence) ?? 0,
  addedAt: row.addedAt ? getCompatibleTime(row.addedAt) : undefined,
  removedAt: row.removedAt ? getCompatibleTime(row.removedAt) : undefined,
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt)
})

/**
 * `addedAt` and `removedAt` are derived here rather than read off the component
 * row: the first period's start is when the part first went on, and the LAST
 * period's end is when it last came off (undefined while it is fitted). For the
 * single-period component every row was before install history existed, that is
 * exactly the pair the columns used to hold.
 *
 * `periods` arrives already ordered by `installSequence`.
 */
export const parseSQLFitnessGearComponent = (
  row: SQLFitnessGearComponent,
  periods: FitnessGearComponentPeriod[]
): FitnessGearComponent => ({
  id: row.id,
  gearId: row.gearId,
  componentType: row.componentType,
  brand: row.brand ?? undefined,
  model: row.model ?? undefined,
  addedAt: periods[0]?.addedAt,
  removedAt: periods[periods.length - 1]?.removedAt,
  periods,
  serviceDistanceMeters: normalizeOptionalNumber(row.serviceDistanceMeters),
  lastAlertedDistanceMeters: normalizeOptionalNumber(
    row.lastAlertedDistanceMeters
  ),
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt),
  deletedAt: row.deletedAt ? getCompatibleTime(row.deletedAt) : undefined
})

export const getOwnedGearRow = async (
  connection: Knex | Knex.Transaction,
  id: string,
  actorId: string
) =>
  connection<SQLFitnessGear>('fitness_gears')
    .where('id', id)
    .where('actorId', actorId)
    .whereNull('deletedAt')
    .first()

export const getOwnedComponentRow = async (
  connection: Knex | Knex.Transaction,
  { id, gearId, actorId }: { id: string; gearId: string; actorId: string }
) =>
  connection<SQLFitnessGearComponent>('fitness_gear_components as c')
    .innerJoin('fitness_gears as g', 'g.id', 'c.gearId')
    .where('c.id', id)
    .where('c.gearId', gearId)
    .where('g.actorId', actorId)
    .whereNull('c.deletedAt')
    .whereNull('g.deletedAt')
    .select('c.*')
    .first()
