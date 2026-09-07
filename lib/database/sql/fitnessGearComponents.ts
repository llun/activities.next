import crypto from 'crypto'
import { Knex } from 'knex'

import {
  getOwnedComponentRow,
  getOwnedGearRow,
  normalizeOptionalNumber,
  parseSQLFitnessGearComponent,
  parseSQLFitnessGearComponentPeriod
} from '@/lib/database/sql/fitnessGearRows'
import {
  CreateFitnessGearComponentParams,
  FitnessGearComponentsDatabase,
  UpdateFitnessGearComponentParams
} from '@/lib/database/sql/fitnessGearTypes'
import { isUniqueConstraintError } from '@/lib/database/sql/utils/isUniqueConstraintError'
import { chunkArray, getWhereInBatchSize } from '@/lib/database/sql/utils/knex'
import {
  FitnessGearComponent,
  FitnessGearComponentPeriod,
  FitnessGearDistanceRollup,
  SQLFitnessGearComponent,
  SQLFitnessGearComponentPeriod
} from '@/lib/types/database/fitnessGear'

/**
 * Every period of the given components, oldest first, keyed by component id.
 *
 * Batched rather than looped for the same reason the rollups are: a gear page
 * reads every component at once, and one query per part is how a page of them
 * turns into a page of queries.
 */
export const getComponentPeriods = async (
  connection: Knex | Knex.Transaction,
  componentIds: string[]
): Promise<Map<string, FitnessGearComponentPeriod[]>> => {
  const periodsByComponentId = new Map<string, FitnessGearComponentPeriod[]>()
  const uniqueIds = [...new Set(componentIds)]
  if (uniqueIds.length === 0) return periodsByComponentId

  for (const chunk of chunkArray(uniqueIds, getWhereInBatchSize(connection))) {
    const rows = await connection<SQLFitnessGearComponentPeriod>(
      'fitness_gear_component_periods'
    )
      .whereIn('componentId', chunk)
      .orderBy('componentId', 'asc')
      .orderBy('installSequence', 'asc')
      .select('*')

    for (const row of rows) {
      const parsed = parseSQLFitnessGearComponentPeriod(row)
      const existing = periodsByComponentId.get(parsed.componentId)
      if (existing) {
        existing.push(parsed)
        continue
      }
      periodsByComponentId.set(parsed.componentId, [parsed])
    }
  }

  return periodsByComponentId
}

export const getOwnedComponent = async (
  connection: Knex | Knex.Transaction,
  params: { id: string; gearId: string; actorId: string }
): Promise<FitnessGearComponent | null> => {
  const row = await getOwnedComponentRow(connection, params)
  if (!row) return null

  const periodsByComponentId = await getComponentPeriods(connection, [row.id])
  return parseSQLFitnessGearComponent(
    row,
    periodsByComponentId.get(row.id) ?? []
  )
}

export const FitnessGearComponentsSQLDatabaseMixin = (
  database: Knex
): FitnessGearComponentsDatabase => ({
  async createFitnessGearComponent(params: CreateFitnessGearComponentParams) {
    const gear = await getOwnedGearRow(database, params.gearId, params.actorId)
    if (!gear) return null

    const currentTime = new Date()
    const data: SQLFitnessGearComponent = {
      id: crypto.randomUUID(),
      gearId: params.gearId,
      componentType: params.componentType,
      brand: params.brand ?? null,
      model: params.model ?? null,
      serviceDistanceMeters: params.serviceDistanceMeters ?? null,
      lastAlertedDistanceMeters: null,
      createdAt: currentTime,
      updatedAt: currentTime,
      deletedAt: null
    }
    const period: SQLFitnessGearComponentPeriod = {
      id: crypto.randomUUID(),
      componentId: data.id,
      installSequence: 1,
      addedAt: params.addedAt ?? null,
      removedAt: params.removedAt ?? null,
      createdAt: currentTime,
      updatedAt: currentTime
    }

    // One transaction, because a component with no period is a shape the rollup
    // must never meet: both of its window tests would be vacuously true and it
    // would claim every activity on the gear.
    await database.transaction(async (trx) => {
      await trx('fitness_gear_components').insert(data)
      await trx('fitness_gear_component_periods').insert(period)
    })

    return parseSQLFitnessGearComponent(data, [
      parseSQLFitnessGearComponentPeriod(period)
    ])
  },

  async getFitnessGearComponents({ gearId, actorId }) {
    const rows = await database<SQLFitnessGearComponent>(
      'fitness_gear_components as c'
    )
      .innerJoin('fitness_gears as g', 'g.id', 'c.gearId')
      .where('c.gearId', gearId)
      .where('g.actorId', actorId)
      .whereNull('c.deletedAt')
      .whereNull('g.deletedAt')
      .select('c.*')
      // Only gives the installed group a stable oldest-first order; where the
      // removed ones land is decided below.
      .orderBy('c.createdAt', 'asc')

    const periodsByComponentId = await getComponentPeriods(
      database,
      rows.map((row) => row.id)
    )

    // Installed parts first, then the replaced ones newest-first. Split here
    // rather than with an `ORDER BY removedAt` because the backends disagree on
    // whether NULLs sort first or last, and "still fitted" has to come first.
    // A refitted part is installed again, so it moves back into the first
    // group: `removedAt` is the LAST period's end, not the first's.
    const parsed = rows.map((row) =>
      parseSQLFitnessGearComponent(row, periodsByComponentId.get(row.id) ?? [])
    )
    const installed = parsed.filter((component) => !component.removedAt)
    const replaced = parsed
      .filter((component) => component.removedAt)
      // Both are non-null: the array was just filtered on `removedAt`.
      .sort(
        (first, second) =>
          (second.removedAt as number) - (first.removedAt as number)
      )
    return [...installed, ...replaced]
  },

  async updateFitnessGearComponent(params: UpdateFitnessGearComponentParams) {
    const existing = await getOwnedComponentRow(database, {
      id: params.id,
      gearId: params.gearId,
      actorId: params.actorId
    })
    if (!existing) return null

    const currentTime = new Date()
    const updateData: Record<string, unknown> = { updatedAt: currentTime }
    if ('componentType' in params && params.componentType !== undefined) {
      updateData.componentType = params.componentType
    }
    if ('brand' in params) updateData.brand = params.brand ?? null
    if ('model' in params) updateData.model = params.model ?? null
    if ('serviceDistanceMeters' in params) {
      updateData.serviceDistanceMeters = params.serviceDistanceMeters ?? null
      if (
        (params.serviceDistanceMeters ?? null) !==
        (normalizeOptionalNumber(existing.serviceDistanceMeters) ?? null)
      ) {
        updateData.lastAlertedDistanceMeters = null
      }
    }

    await database.transaction(async (trx) => {
      await trx('fitness_gear_components')
        .where('id', params.id)
        .update(updateData)

      // The dates live on the periods now, and only the outermost bounds are
      // reachable from here: `addedAt` is the first period's start, `removedAt`
      // the last period's end. Ordered by `installSequence` rather than by the
      // dates themselves, because the first period's `addedAt` may be null.
      //
      // Each write carries its own ordering predicate, and that is not
      // belt-and-braces over the route's 422. WHICH period is last is resolved
      // here, at write time, while the caller validated the periods it had
      // READ — and a refit landing between the two appends a new one, so the
      // bound lands on a row nobody checked. A period written `[Aug 1, Feb 15)`
      // can hold no activity at all, and once a later refit buries it in the
      // middle it is beyond the route's reach forever, because only the first
      // and last are ever re-examined. Expressed as a predicate rather than a
      // re-read for the reason every state change in this file is: a decision
      // taken in front of the write is a decision about a state that may no
      // longer hold when the write lands.
      if ('addedAt' in params || 'removedAt' in params) {
        const orderedPeriods = await trx<SQLFitnessGearComponentPeriod>(
          'fitness_gear_component_periods'
        )
          .where('componentId', params.id)
          .orderBy('installSequence', 'asc')
          .select('*')
        const first = orderedPeriods[0]
        const last = orderedPeriods[orderedPeriods.length - 1]

        // Both bounds land on the SAME row when the component has one period,
        // and then that row's stored state says nothing about whether the edit
        // is ordered — both ends are being replaced. Writing them separately
        // makes the first write's predicate compare the new `addedAt` against
        // the OLD `removedAt` the second write is about to overwrite, so moving
        // a window wholesale applied only half of itself and left the other
        // half silently dropped behind a 200.
        const writesBothBoundsOnOneRow =
          first &&
          last &&
          first.id === last.id &&
          'addedAt' in params &&
          'removedAt' in params

        if (writesBothBoundsOnOneRow) {
          const addedAt = params.addedAt ?? null
          const removedAt = params.removedAt ?? null
          // Nothing stored is consulted, so the ordering is settled here.
          //
          // Either bound being null means "open on that side", which cannot
          // invert anything — hence the two negations rather than the
          // `addedAt && removedAt && removedAt > addedAt` this reads like. That
          // rewrite is not equivalent: it skips the write whenever a bound is
          // cleared, so clearing one while moving the other silently applies
          // neither, behind a 200.
          //
          // The skip is a floor, not the guard callers should rely on: it
          // refuses an inverted pair rather than writing one, but says nothing
          // about it. The route answers 422 first, through the shared
          // `getComponentPeriodBoundsError`, and a future caller reaching this
          // method some other way needs to do the same.
          if (!addedAt || !removedAt || removedAt > addedAt) {
            await trx('fitness_gear_component_periods')
              .where('id', first.id)
              .update({ addedAt, removedAt, updatedAt: currentTime })
          }
        } else {
          // One bound per row, so each is checked against the other end the row
          // actually keeps — as a predicate on the write, not a decision taken
          // from the read above it. WHICH period is last is resolved here, at
          // write time, while a caller validated the periods it had READ, and a
          // refit landing between the two appends a new one: the bound would
          // otherwise land on a row nobody checked and write a period no
          // activity can fall inside, which a later refit then buries in the
          // middle where nothing looks again.
          if ('addedAt' in params && first) {
            const query = trx('fitness_gear_component_periods').where(
              'id',
              first.id
            )
            // Clearing a bound cannot invert anything.
            const addedAt = params.addedAt
            if (addedAt) {
              query.where((builder) =>
                builder
                  .whereNull('removedAt')
                  .orWhere('removedAt', '>', addedAt)
              )
            }
            await query.update({
              addedAt: addedAt ?? null,
              updatedAt: currentTime
            })
          }

          if ('removedAt' in params && last) {
            const query = trx('fitness_gear_component_periods').where(
              'id',
              last.id
            )
            const removedAt = params.removedAt
            if (removedAt) {
              query.where((builder) =>
                builder.whereNull('addedAt').orWhere('addedAt', '<', removedAt)
              )
            }
            await query.update({
              removedAt: removedAt ?? null,
              updatedAt: currentTime
            })
          }
        }
      }
    })

    return getOwnedComponent(database, {
      id: params.id,
      gearId: params.gearId,
      actorId: params.actorId
    })
  },

  async deleteFitnessGearComponent({ id, gearId, actorId }) {
    const existing = await getOwnedComponentRow(database, {
      id,
      gearId,
      actorId
    })
    if (!existing) return false

    const currentTime = new Date()
    const deleted = await database('fitness_gear_components')
      .where('id', id)
      .whereNull('deletedAt')
      .update({ deletedAt: currentTime, updatedAt: currentTime })
    return deleted > 0
  },

  async retireFitnessGearComponent({ id, gearId, actorId }) {
    const existing = await getOwnedComponentRow(database, {
      id,
      gearId,
      actorId
    })
    if (!existing) return null

    // The state change is a predicate on the UPDATE statement rather than a
    // decision taken from a read in front of it. Only a real transition writes,
    // so two concurrent requests (two tabs, a retried request) result in one
    // update; 0 rows affected maps straight to null (which the route answers as 404).
    //
    // It closes the OPEN period, of which a component has at most one — a refit
    // only opens a period when none is open, and an edit can only move the
    // outermost bounds.
    const currentTime = new Date()
    const updated = await database('fitness_gear_component_periods')
      .where('componentId', id)
      .whereNull('removedAt')
      // The periods table has no `deletedAt` of its own, so the component's is
      // carried in as a subquery rather than left to the ownership read above.
      // That read is a decision taken in front of the write, and a soft-delete
      // landing between the two would otherwise let this close a period on a
      // component nothing can reach again.
      .whereIn(
        'componentId',
        database('fitness_gear_components')
          .select('id')
          .where('id', id)
          .whereNull('deletedAt')
      )
      .update({ removedAt: currentTime, updatedAt: currentTime })

    if (!updated) return null

    await database('fitness_gear_components')
      .where('id', id)
      .update({ updatedAt: currentTime })

    return getOwnedComponent(database, { id, gearId, actorId })
  },

  async refitFitnessGearComponent({ id, gearId, actorId }) {
    const currentTime = new Date()

    try {
      const opened = await database.transaction(async (trx) => {
        const existing = await getOwnedComponentRow(trx, {
          id,
          gearId,
          actorId
        })
        if (!existing) return null

        const periods = await trx<SQLFitnessGearComponentPeriod>(
          'fitness_gear_component_periods'
        )
          .where('componentId', id)
          .orderBy('installSequence', 'desc')
          .select('*')

        // Already fitted — the same no-op answer retiring gives for a part
        // already retired, and the route turns it into a 404.
        if (periods.some((period) => !period.removedAt)) return null

        const highestSequence = periods.reduce(
          (highest, period) =>
            Math.max(
              highest,
              normalizeOptionalNumber(period.installSequence) ?? 0
            ),
          0
        )

        await trx('fitness_gear_component_periods').insert({
          id: crypto.randomUUID(),
          componentId: id,
          installSequence: highestSequence + 1,
          // The new period starts NOW, never at the moment the part came off:
          // backdating it to the retirement is precisely the retroactive credit
          // this table exists to stop.
          addedAt: currentTime,
          removedAt: null,
          createdAt: currentTime,
          updatedAt: currentTime
        })
        await trx('fitness_gear_components')
          .where('id', id)
          .update({ updatedAt: currentTime })

        return true
      })

      if (!opened) return null
    } catch (error) {
      // Two refits racing read the same highest sequence and both try to claim
      // the next one; `(componentId, installSequence)` is UNIQUE, so the loser
      // lands here and gets the same "already fitted" no-op the winner's second
      // click would.
      //
      // Classified from the ERROR, through the same shared helper every other
      // racing insert in this directory uses — not by re-reading the component
      // and suppressing when it happens to look fitted. That re-read cannot
      // tell this transaction's unique violation from any other failure inside
      // it (a dropped connection, a lock timeout, a bug in either write), so a
      // real fault landing while some other writer had just refitted the part
      // would be reported as a tidy 404 and leave no trace.
      if (!isUniqueConstraintError(error)) throw error
      return null
    }

    return getOwnedComponent(database, { id, gearId, actorId })
  },

  async getFitnessGearComponentDistanceRollups({ actorId, gearIds }) {
    const uniqueIds = [...new Set(gearIds)]
    const rollups: Record<string, FitnessGearDistanceRollup> = {}
    if (uniqueIds.length === 0) return rollups

    for (const chunk of chunkArray(
      uniqueIds,
      getWhereInBatchSize(database, 3)
    )) {
      // One grouped query covers every component of every gear in the chunk.
      // The install window lives in the JOIN condition rather than the WHERE
      // clause so a component with no matching activity still produces a row
      // (COUNT over the joined id then yields 0 instead of dropping it).
      //
      // The window belongs to the PERIOD, not the component: a part that came
      // off and went back on has one row per stretch it was fitted, and the
      // activities of the gap between them belong to neither. Summing over the
      // period join is safe because periods never overlap — a refit only opens
      // one when none is open, and an edit can only move the outermost bounds —
      // so no activity is counted twice.
      //
      // `activityStartTime` is compared column-to-column against the window
      // bounds, which is safe on both backends because knex writes all three
      // columns in the same representation. Never introduce raw date
      // arithmetic here without an isSQLiteClient branch.
      //
      // An activity with a NULL `activityStartTime` (a GPX carrying no
      // timestamps) therefore counts only for a period open on that side. That
      // is intended: an activity that cannot be placed in time cannot be placed
      // inside `[addedAt, removedAt)` either, so a part fitted on a date must
      // not claim it. The consequence is that a gear total can legitimately
      // exceed the sum of its components' totals.
      const rows = await database('fitness_gear_components as c')
        .innerJoin('fitness_gears as g', 'g.id', 'c.gearId')
        .leftJoin(
          'fitness_gear_component_periods as p',
          'p.componentId',
          'c.id'
        )
        .leftJoin('fitness_files as f', function () {
          this.on('f.gearId', '=', 'c.gearId')
            // Same actor scope the gear rollup applies. Not reachable today —
            // every caller resolves gear for the file's own actor — but without
            // it the two rollups disagree the moment one does not, and a
            // component total silently absorbing another actor's distance while
            // the gear total stays right is not a discrepancy anyone would
            // manage to reproduce.
            .andOn('f.actorId', '=', 'g.actorId')
            // Fail closed. A component with no period row at all is a shape
            // nothing here creates, but without this both window tests below
            // read as TRUE against the NULLs of the missing row and the
            // component claims every activity on the gear.
            .andOnNotNull('p.id')
            .andOnNull('f.deletedAt')
            .andOnVal('f.processingStatus', '=', 'completed')
            .andOnVal('f.isPrimary', '=', true)
            .andOn(function () {
              this.onNull('p.addedAt').orOn(
                'f.activityStartTime',
                '>=',
                'p.addedAt'
              )
            })
            .andOn(function () {
              this.onNull('p.removedAt').orOn(
                'f.activityStartTime',
                '<',
                'p.removedAt'
              )
            })
        })
        .where('g.actorId', actorId)
        .whereNull('g.deletedAt')
        .whereNull('c.deletedAt')
        .whereIn('c.gearId', chunk)
        .groupBy('c.id')
        .select(
          'c.id as componentId',
          database.raw('COUNT(??) as ??', ['f.id', 'activityCount']),
          database.raw('COALESCE(SUM(??), 0) as ??', [
            'f.totalDistanceMeters',
            'distanceMeters'
          ])
        )

      for (const row of rows as Record<string, unknown>[]) {
        rollups[String(row.componentId)] = {
          distanceMeters: Number(row.distanceMeters) || 0,
          activityCount: Number(row.activityCount) || 0
        }
      }
    }

    return rollups
  },

  async setFitnessGearComponentLastAlertedDistance({
    id,
    lastAlertedDistanceMeters,
    onlyIfBelowThresholdMeters
  }) {
    // See the gear-level twin: the conditional write is what makes concurrent
    // evaluations fire one reminder rather than one each.
    const query = database('fitness_gear_components')
      .where('id', id)
      .whereNull('deletedAt')
    if (onlyIfBelowThresholdMeters !== undefined) {
      query.where((builder) =>
        builder
          .whereNull('lastAlertedDistanceMeters')
          .orWhere('lastAlertedDistanceMeters', '<', onlyIfBelowThresholdMeters)
      )
    }

    const updated = await query.update({
      lastAlertedDistanceMeters,
      updatedAt: new Date()
    })
    return updated > 0
  }
})

export const FitnessGearComponentSQLDatabaseMixin =
  FitnessGearComponentsSQLDatabaseMixin
