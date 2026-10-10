import type { Selectable } from 'kysely'

import type { Db } from '@/lib/database/kysely'
import type {
  FitnessGearComponentPeriods,
  FitnessGearComponents,
  FitnessGears
} from '@/lib/database/kysely/db'
import type {
  FitnessGear,
  FitnessGearComponent,
  FitnessGearComponentPeriod,
  FitnessGearKind
} from '@/lib/types/database/fitnessGear'

export type GearRow = Selectable<FitnessGears>
export type ComponentRow = Selectable<FitnessGearComponents>
export type PeriodRow = Selectable<FitnessGearComponentPeriods>

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

// Timestamps arrive as epoch milliseconds from the driver, on both backends.
export const toFitnessGear = (row: GearRow): FitnessGear => ({
  id: row.id,
  actorId: row.actorId,
  // Written only from FitnessGearKind; the column is a plain varchar.
  kind: row.kind as FitnessGearKind,
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
  retiredAt: row.retiredAt ?? undefined,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  deletedAt: row.deletedAt ?? undefined
})

export const toFitnessGearComponentPeriod = (
  row: PeriodRow
): FitnessGearComponentPeriod => ({
  id: row.id,
  componentId: row.componentId,
  installSequence: normalizeOptionalNumber(row.installSequence) ?? 0,
  addedAt: row.addedAt ?? undefined,
  removedAt: row.removedAt ?? undefined,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
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
export const toFitnessGearComponent = (
  row: ComponentRow,
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
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  deletedAt: row.deletedAt ?? undefined,
  productUrl: row.productUrl ?? undefined
})

export const getOwnedGearRow = (
  db: Db,
  id: string,
  actorId: string
): Promise<GearRow | undefined> =>
  db
    .selectFrom('fitness_gears')
    .selectAll()
    .where('id', '=', id)
    .where('actorId', '=', actorId)
    .where('deletedAt', 'is', null)
    .limit(1)
    .executeTakeFirst()

export const getOwnedComponentRow = (
  db: Db,
  { id, gearId, actorId }: { id: string; gearId: string; actorId: string }
): Promise<ComponentRow | undefined> =>
  db
    .selectFrom('fitness_gear_components as c')
    .innerJoin('fitness_gears as g', 'g.id', 'c.gearId')
    .selectAll('c')
    .where('c.id', '=', id)
    .where('c.gearId', '=', gearId)
    .where('g.actorId', '=', actorId)
    .where('c.deletedAt', 'is', null)
    .where('g.deletedAt', 'is', null)
    .limit(1)
    .executeTakeFirst()
