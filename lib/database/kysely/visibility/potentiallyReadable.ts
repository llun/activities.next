import {
  type Expression,
  type ExpressionBuilder,
  type SqlBool,
  sql
} from 'kysely'

import type { DB, Db } from '@/lib/database/kysely'
import { jsonText } from '@/lib/database/kysely/dialect'
import { FollowStatus } from '@/lib/types/domain/follow'
import { StatusType } from '@/lib/types/domain/status'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'

export const PUBLIC_ACTIVITY_RECIPIENTS = [
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
]

// The statuses `viewerId` may be able to read, for a query over `statuses`:
// public and unlisted ones, the viewer's own, the ones addressed to them, the
// followers-only ones of an actor they follow, and a Note or Poll with no
// recipients that replies to a status the viewer wrote or takes part in through
// a direct conversation. The Kysely twin of applyPotentiallyReadableStatusFilter
// (lib/database/sql/utils/statusVisibility.ts); visibilityEquivalence.test.ts
// runs both over the same rows.
export const potentiallyReadableStatus = (
  db: Db,
  eb: ExpressionBuilder<DB, 'statuses'>,
  viewerId: string
): Expression<SqlBool> => {
  // The reply points at the parent by id, or by url with its hash.
  const repliesToParent = (byUrl: boolean) =>
    byUrl
      ? eb.and([
          eb(
            'statuses.replyHash',
            '=',
            sql.ref<string>('reply_parent_statuses.urlHash')
          ),
          eb(
            'statuses.reply',
            '=',
            sql.ref<string>('reply_parent_statuses.url')
          )
        ])
      : eb('statuses.reply', '=', sql.ref<string>('reply_parent_statuses.id'))
  const parentByViewer = (byUrl: boolean) =>
    eb.exists(
      eb
        .selectFrom('statuses as reply_parent_statuses')
        .select(sql.lit(1).as('one'))
        .where('reply_parent_statuses.actorId', '=', viewerId)
        .where(repliesToParent(byUrl))
    )
  const parentInViewerConversation = (byUrl: boolean) =>
    eb.exists(
      eb
        .selectFrom('statuses as reply_parent_statuses')
        .innerJoin(
          'direct_conversation_statuses as reply_parent_direct_statuses',
          'reply_parent_direct_statuses.statusId',
          'reply_parent_statuses.id'
        )
        .innerJoin(
          'direct_conversation_participants as reply_parent_direct_participants',
          'reply_parent_direct_participants.conversationId',
          'reply_parent_direct_statuses.conversationId'
        )
        .select(sql.lit(1).as('one'))
        .where('reply_parent_direct_participants.actorId', '=', viewerId)
        .where(repliesToParent(byUrl))
    )

  return eb.or([
    eb(
      'statuses.id',
      'in',
      eb
        .selectFrom('recipients')
        .select('recipients.statusId')
        .where('recipients.actorId', 'in', [
          ...PUBLIC_ACTIVITY_RECIPIENTS,
          viewerId
        ])
    ),
    eb('statuses.actorId', '=', viewerId),
    eb.and([
      eb('statuses.type', 'in', [StatusType.enum.Note, StatusType.enum.Poll]),
      eb.not(
        eb.exists(
          eb
            .selectFrom('recipients as reply_recipients')
            .select(sql.lit(1).as('one'))
            .whereRef('reply_recipients.statusId', '=', 'statuses.id')
        )
      ),
      eb.or([
        parentByViewer(false),
        parentByViewer(true),
        parentInViewerConversation(false),
        parentInViewerConversation(true)
      ])
    ]),
    eb.exists(
      eb
        .selectFrom('recipients as followers_recipients')
        .leftJoin(
          'actors as status_actors',
          'status_actors.id',
          'statuses.actorId'
        )
        .select(sql.lit(1).as('one'))
        .whereRef('followers_recipients.statusId', '=', 'statuses.id')
        // The audience is the author's stored followers URL, or, for an actor
        // whose settings lack one, `<actor id>/followers`.
        .where((audience) =>
          audience.or([
            audience(
              'followers_recipients.actorId',
              '=',
              jsonText(db, 'status_actors.settings', 'followersUrl')
            ),
            audience(
              'followers_recipients.actorId',
              '=',
              sql<string>`${sql.ref('statuses.actorId')} || '/followers'`
            )
          ])
        )
        .where((follower) =>
          follower.exists(
            follower
              .selectFrom('follows')
              .select(sql.lit(1).as('one'))
              .where('follows.actorId', '=', viewerId)
              .whereRef('follows.targetActorId', '=', 'statuses.actorId')
              .where('follows.status', '=', FollowStatus.enum.Accepted)
          )
        )
    )
  ])
}
