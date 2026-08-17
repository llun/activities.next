import { Knex } from 'knex'

/**
 * The activity filter every fitness rollup shares, copied from
 * `getFitnessActivitySummary` rather than re-derived so the totals line up with
 * the fitness overview. It lives here, rather than in the module of whichever
 * rollup needed it first, because a second copy is how two surfaces start
 * reporting different numbers for the same activities.
 *
 * Not quite identical to that query, deliberately: the summary additionally
 * requires a non-null `activityType` and `activityStartTime` because it groups
 * and buckets by them. Gear totals count an activity whatever it is and whenever
 * it happened, so a timestamp-less GPX contributes here and is invisible there.
 *
 * `isPrimary` is the one clause that does not transfer unchanged to devices, and
 * `forDeviceLink` is what replaces it.
 *
 * A merged same-ride post keeps one file and marks the rest non-primary, which
 * is right for a bike: the ride happened once, so it counts once. For a device,
 * `isPrimary` answers the wrong question — the merge groups by TIME OVERLAP and
 * never looks at the device columns, so which file won says nothing about which
 * device recorded it. Two devices on one ride (a head unit and a watch) leave
 * two files, and the non-primary one is the only evidence the watch exists at
 * all; `isPrimary` alone gives that device a page reporting 0 activities
 * forever. One device that produced two files for one ride (a `.fit` beside a
 * `.gpx`, or a manual upload beside the Strava sync) also leaves two files, and
 * counting both reports one ride twice.
 *
 * The rule that satisfies both is per RIDE per DEVICE, not per file: of the
 * countable files sharing a `(statusId, deviceGearId)`, exactly one survives —
 * the primary if this device owns it, otherwise the lowest id. Expressed as
 * "nothing else beats me", so it needs no window function and reads the same on
 * every backend.
 *
 * Note what the sibling check does NOT do: it does not defer to a file that is
 * itself uncountable. A merge writes the primary as `pending` and the
 * secondaries as `completed` (see `assignFitnessFilesToImportedStatus`), so
 * deferring to an unfinished — or permanently `failed` — primary would drop the
 * ride from the device entirely. A file with no `statusId` was never merged
 * into a post and has no siblings to lose to: the column-to-column comparison
 * is never true for a NULL, so it always counts.
 *
 * Both the rollup and the activity list apply this identical predicate, so a
 * device's count and its page can only ever differ by an activity whose post
 * was deleted: the page renders the posts these rows were published as, and
 * deleting a status only nulls `fitness_files.statusId`, leaving a row that
 * still counts here with nothing left to show.
 */
export const applyCountableActivityFilter = (
  database: Knex,
  query: Knex.QueryBuilder,
  tableAlias: string,
  { forDeviceLink = false }: { forDeviceLink?: boolean } = {}
) => {
  const filtered = query
    .whereNull(`${tableAlias}.deletedAt`)
    .where(`${tableAlias}.processingStatus`, 'completed')
  if (!forDeviceLink) return filtered.where(`${tableAlias}.isPrimary`, true)

  return filtered.whereNotExists((sub) =>
    sub
      .select(database.raw('1'))
      .from('fitness_files as sibling')
      // A sibling only speaks for the ride if it counts itself.
      .whereNull('sibling.deletedAt')
      .where('sibling.processingStatus', 'completed')
      .whereRaw('?? = ??', ['sibling.statusId', `${tableAlias}.statusId`])
      .whereRaw('?? = ??', [
        'sibling.deviceGearId',
        `${tableAlias}.deviceGearId`
      ])
      .where((beats) =>
        beats
          // The primary wins outright...
          .where((primaryWins) =>
            primaryWins
              .where('sibling.isPrimary', true)
              .where(`${tableAlias}.isPrimary`, false)
          )
          // ...and among equals, the lowest id does, so a device with several
          // secondaries and no primary of its own still keeps exactly one.
          .orWhere((lowestIdWins) =>
            lowestIdWins
              .whereRaw('?? = ??', [
                'sibling.isPrimary',
                `${tableAlias}.isPrimary`
              ])
              .whereRaw('?? < ??', ['sibling.id', `${tableAlias}.id`])
          )
      )
  )
}
