import {
  type Expression,
  type ExpressionBuilder,
  type SqlBool,
  sql
} from 'kysely'

import type { DB } from '@/lib/database/kysely'

// Drops the `timelines` rows whose author is a member of one of the viewer's
// exclusive lists, for the home feed (https://docs.joinmastodon.org/entities/List/#exclusive),
// as a NOT EXISTS read at query time, so toggling `exclusive` or changing a
// membership applies to rows already materialized. Only the viewer's own lists
// count, and the viewer's own posts always stay. The Kysely twin of
// applyExclusiveListFilter (lib/database/sql/utils/exclusiveLists.ts);
// visibilityEquivalence.test.ts runs both over the same rows.
export const notFromExclusiveListMember = (
  eb: ExpressionBuilder<DB, 'timelines'>,
  viewerActorId: string
): Expression<SqlBool> =>
  eb.not(
    eb.exists(
      eb
        .selectFrom('list_accounts as exclusive_list_accounts')
        .innerJoin(
          'lists as exclusive_lists',
          'exclusive_lists.id',
          'exclusive_list_accounts.listId'
        )
        .select(sql.lit(1).as('one'))
        .where('exclusive_lists.actorId', '=', viewerActorId)
        .where('exclusive_lists.exclusive', '=', true)
        .whereRef(
          'exclusive_list_accounts.targetActorId',
          '=',
          'timelines.statusActorId'
        )
        .where((own) =>
          own.not(
            own('exclusive_list_accounts.targetActorId', '=', viewerActorId)
          )
        )
    )
  )
