import type { Expression, ExpressionBuilder, SqlBool } from 'kysely'

import type { DB } from '@/lib/database/kysely'

/**
 * The activities every fitness rollup counts, for a query over `fitness_files`:
 * not deleted, finished processing, and the primary file of its post, or with
 * `forDeviceLink` one file per post per device (the primary when the device
 * owns it, otherwise the lowest id).
 *
 * The Kysely twin of applyCountableActivityFilter
 * (lib/database/sql/utils/countableActivity.ts), which explains each rule and
 * still serves the unported fitness file and route queries;
 * countableActivity.test.ts runs both over the same rows.
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
              // ...and among equals, the lowest id does.
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
