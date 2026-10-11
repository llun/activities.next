import type { Expression, ExpressionBuilder, SqlBool } from 'kysely'

import type { DB } from '@/lib/database/kysely'

/**
 * The activities every fitness rollup counts, for a query over `fitness_files`:
 * not deleted, finished processing, and the primary file of its post, or with
 * `forDeviceLink` one file per post per device (the primary when the device
 * owns it, otherwise the lowest id). The gear rollups and activity list, the
 * fitness overview reads and the cached route aggregates all use it. It lives
 * here, rather than in the module of whichever rollup needed it first, because
 * a second copy is how two surfaces start reporting different numbers for the
 * same activities. countableActivity.test.ts checks it against the rule
 * written out in JavaScript; change both together.
 *
 * Not quite identical to the overview summary's own predicate, deliberately:
 * the summary additionally requires a non-null `activityStartTime` because it
 * buckets by it, but it does NOT require an `activityType`: an untyped
 * activity is counted as its own group, so the overview totals equal the
 * calendar's. Gear totals count an activity whatever it is and whenever it
 * happened, so a timestamp-less GPX contributes here and is invisible there.
 *
 * `isPrimary` is the one clause that does not transfer unchanged to devices,
 * and `forDeviceLink` is what replaces it.
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
export const countableActivity = (
  eb: ExpressionBuilder<DB, 'fitness_files'>,
  { forDeviceLink = false }: { forDeviceLink?: boolean } = {}
): Expression<SqlBool> => {
  const counted = [
    eb('fitness_files.deletedAt', 'is', null),
    eb('fitness_files.processingStatus', '=', 'completed')
  ]
  if (!forDeviceLink) {
    return eb.and([...counted, eb('fitness_files.isPrimary', '=', true)])
  }

  return eb.and([
    ...counted,
    eb.not(
      eb.exists(
        eb
          .selectFrom('fitness_files as sibling')
          .select(eb.lit(1).as('one'))
          // A sibling only speaks for the ride if it counts itself.
          .where('sibling.deletedAt', 'is', null)
          .where('sibling.processingStatus', '=', 'completed')
          .whereRef('sibling.statusId', '=', 'fitness_files.statusId')
          .whereRef('sibling.deviceGearId', '=', 'fitness_files.deviceGearId')
          .where((beats) =>
            beats.or([
              // The primary wins outright...
              beats.and([
                beats('sibling.isPrimary', '=', true),
                beats('fitness_files.isPrimary', '=', false)
              ]),
              // ...and among equals, the lowest id does, so a device with
              // several secondaries and no primary of its own still keeps
              // exactly one.
              beats.and([
                beats(
                  'sibling.isPrimary',
                  '=',
                  beats.ref('fitness_files.isPrimary')
                ),
                beats('sibling.id', '<', beats.ref('fitness_files.id'))
              ])
            ])
          )
      )
    )
  ])
}
