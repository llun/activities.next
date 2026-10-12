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

// The statuses a list feed may show at all, for a query over `statuses`.
// Mastodon's fan-out only delivers public, unlisted and followers-only
// statuses to lists (FanOutOnWriteService#deliver_to_lists!), and the merge
// that backfills a new member reads `list_eligible_visibility`; without this
// filter the owner's own direct messages (once they add themselves) and a
// member's direct message to the owner both surfaced in the list, although
// neither ever appears in Home, which routes them to the Direct feed.
//
// A boost is never direct. Any other status is eligible when one of its
// recipients is the public collection or a followers collection; otherwise it
// is addressed to specific people only, and a status with no recipient rows is
// not eligible either. That is isDirectStatus (lib/utils/directStatus.ts),
// which decides whether a status lands in Home or Direct, with one widening.
// As in getVisibility, a recipient ending in `/followers` counts whoever's
// collection it is, so a list keeps what Home keeps (potentiallyReadableStatus
// accepts only the author's own `/followers` URL; narrowing this term to match
// would drop such posts). The widening is the author's STORED followers URL,
// because not every server names the collection that way (Friendica's is
// `/followers/<nick>`). LIKE folds ASCII case on SQLite, not on PostgreSQL, so
// on SQLite an upper-case `/FOLLOWERS` suffix counts too.
//
// Pure EXISTS on `statuses`, so it composes with the list timeline's other
// filters and runs before LIMIT; the recipients lookup is served by
// recipients_status_type_actor_idx (statusId leading) and the author by
// actors_id_unique. visibility.test.ts pins what it selects.
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

// A list's Mastodon replies_policy
// (https://docs.joinmastodon.org/entities/List/#replies_policy), for a query
// over `statuses`, as a pure WHERE that runs before LIMIT. As in
// FeedManager#filter_from_list?, a status always passes when it is not a
// reply, when it is a self-reply (a thread continuation) or when it replies to
// the list owner; the parent is matched by id, or by url with its hash, as the
// visibility filter and resolveParentStatusIdByReply match it. Only the
// remaining replies follow the policy:
// - 'none': no further replies.
// - 'list': replies whose parent author is a member of the list.
// - 'followed': replies whose parent author the owner follows.
// A reply whose parent is not stored here has no parent author, so it is
// neither a member's nor followed and is held back under every policy.
//
// The owner's own posts (an owner may be a member of their own list) follow
// the same rules under 'none' and 'list', but under 'followed' every one of
// them passes, a reply to a stranger or to an unstored parent included:
// Mastodon's list filter is filter_from_list? OR filter_from_home, and under
// show_followed? the first never filters while the second returns early for
// the receiver's own statuses. visibility.test.ts pins what each policy lets
// through.
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
