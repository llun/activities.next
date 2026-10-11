import {
  type Expression,
  type ExpressionBuilder,
  type SqlBool,
  sql
} from 'kysely'

import type { DB, Db } from '@/lib/database/kysely'
import { jsonText } from '@/lib/database/kysely/dialect'
import { PUBLIC_ACTIVITY_RECIPIENTS } from '@/lib/database/kysely/visibility/potentiallyReadable'
import { FollowStatus } from '@/lib/types/domain/follow'
import type { ListRepliesPolicy } from '@/lib/types/domain/list'
import { StatusType } from '@/lib/types/domain/status'

// The statuses a list feed may show at all, for a query over `statuses`: a
// boost, or a status with a recipient that is the public collection, a
// collection ending in `/followers`, or the author's stored followers URL.
// Everything else is addressed to specific people only (a direct message),
// which Mastodon never delivers to a list. The Kysely twin of
// applyListEligibleStatusFilter (lib/database/sql/utils/listEligibleStatus.ts,
// which explains each rule); visibilityEquivalence.test.ts runs both over the
// same rows.
export const listEligibleStatus = (
  db: Db,
  eb: ExpressionBuilder<DB, 'statuses'>
): Expression<SqlBool> =>
  eb.or([
    eb('statuses.type', '=', StatusType.enum.Announce),
    eb.exists(
      eb
        .selectFrom('recipients as list_eligible_recipients')
        .leftJoin(
          'actors as list_eligible_authors',
          'list_eligible_authors.id',
          'statuses.actorId'
        )
        .select(sql.lit(1).as('one'))
        .whereRef('list_eligible_recipients.statusId', '=', 'statuses.id')
        .where((audience) =>
          audience.or([
            audience(
              'list_eligible_recipients.actorId',
              'in',
              PUBLIC_ACTIVITY_RECIPIENTS
            ),
            audience('list_eligible_recipients.actorId', 'like', '%/followers'),
            audience(
              'list_eligible_recipients.actorId',
              '=',
              jsonText(db, 'list_eligible_authors.settings', 'followersUrl')
            )
          ])
        )
    )
  ])

// A list's Mastodon replies_policy, for a query over `statuses`: a non-reply
// always passes, and so does a reply whose stored parent (matched by id, or by
// url with its hash) is by the same author or by the list owner. 'list' also
// lets through a reply to a member of the list, 'followed' a reply to an
// account the owner follows and anything the owner wrote. The Kysely twin of
// applyListRepliesPolicyFilter (lib/database/sql/utils/listRepliesPolicy.ts,
// which explains each rule); visibilityEquivalence.test.ts runs both over the
// same rows.
export const listRepliesPolicyAllows = (
  eb: ExpressionBuilder<DB, 'statuses'>,
  {
    repliesPolicy,
    listId,
    ownerId
  }: { repliesPolicy: ListRepliesPolicy; listId: string; ownerId: string }
): Expression<SqlBool> => {
  const permittedReply = (byUrl: boolean) =>
    eb.exists(
      eb
        .selectFrom('statuses as reply_policy_parent')
        .select(sql.lit(1).as('one'))
        .$if(byUrl, (qb) =>
          qb
            .whereRef('statuses.replyHash', '=', 'reply_policy_parent.urlHash')
            .whereRef('statuses.reply', '=', 'reply_policy_parent.url')
        )
        .$if(!byUrl, (qb) =>
          qb.whereRef('statuses.reply', '=', 'reply_policy_parent.id')
        )
        .where((author) =>
          author.or([
            // A self-reply (thread continuation).
            author(
              'reply_policy_parent.actorId',
              '=',
              author.ref('statuses.actorId')
            ),
            // A reply to the list owner.
            author('reply_policy_parent.actorId', '=', ownerId),
            ...(repliesPolicy === 'list'
              ? [
                  author.exists(
                    author
                      .selectFrom('list_accounts as reply_policy_members')
                      .select(sql.lit(1).as('one'))
                      .where('reply_policy_members.listId', '=', listId)
                      .where('reply_policy_members.actorId', '=', ownerId)
                      .whereRef(
                        'reply_policy_members.targetActorId',
                        '=',
                        'reply_policy_parent.actorId'
                      )
                  )
                ]
              : []),
            ...(repliesPolicy === 'followed'
              ? [
                  author.exists(
                    author
                      .selectFrom('follows as reply_policy_follows')
                      .select(sql.lit(1).as('one'))
                      .where('reply_policy_follows.actorId', '=', ownerId)
                      .where(
                        'reply_policy_follows.status',
                        '=',
                        FollowStatus.enum.Accepted
                      )
                      .whereRef(
                        'reply_policy_follows.targetActorId',
                        '=',
                        'reply_policy_parent.actorId'
                      )
                  )
                ]
              : [])
            // 'none': only self-replies and replies to the owner pass.
          ])
        )
    )

  return eb.or([
    eb('statuses.reply', '=', ''),
    eb('statuses.reply', 'is', null),
    // Under 'followed', anything the owner wrote passes too.
    ...(repliesPolicy === 'followed'
      ? [eb('statuses.actorId', '=', ownerId)]
      : []),
    permittedReply(false),
    permittedReply(true)
  ])
}
