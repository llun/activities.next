import { expressionBuilder, sql } from 'kysely'

import { sameActorReplyParentMatches } from '@/lib/database/domains/status/replyParent'
import type { GetRepliesTabStatusIdsParams } from '@/lib/database/domains/status/types'
import type { DB, Db } from '@/lib/database/kysely'
import { actorVisibleRecipientIds } from '@/lib/database/kysely/visibility/actorVisible'
import { StatusType } from '@/lib/types/domain/status'

/**
 * How many steps up the actor's self-reply chain `getRepliesTabStatusIds`
 * walks before it stops looking for the chain's first post. A chain longer than
 * this falls back to Mastodon's rule (a reply to one's own post is not a reply),
 * which puts it on the Posts tab. It also bounds a chain that loops back on
 * itself, which remote input can produce.
 */
export const SELF_CHAIN_DEPTH_CAP = 20

type ChainRow = {
  startId: string
  depth: number | string
  reply: string | null
  readable: number | string
}

type ProfileTab = 'posts' | 'replies'

// The tab one walked row decides, for the deepest row of its chain.
const tabOf = (row: ChainRow): ProfileTab => {
  const depth = Number(row.depth)
  // The page's own reply, with no parent by the same actor: a reply to
  // someone else, or to a parent this server does not have.
  if (depth === 0) return 'replies'
  // An ancestor the viewer cannot read ends the walk. Its being the actor's
  // own post is what `exclude_replies` already tells anyone, so the chain
  // counts as Mastodon counts it: not a reply.
  if (Number(row.readable) !== 1) return 'posts'
  // The chain's first post is a top-level post.
  if (!row.reply) return 'posts'
  // Out of steps: Mastodon's rule again.
  if (depth >= SELF_CHAIN_DEPTH_CAP) return 'posts'
  // The first post of the chain replies to someone else (or a missing parent).
  return 'replies'
}

/**
 * The ids among `statusIds` that belong on the profile's Replies tab: the
 * actor's replies whose self-reply chain starts with a reply to someone else,
 * or to a parent that cannot be found. The first post of the author's chain
 * decides, so a self-reply under a top-level post stays with that post on
 * Posts, and a self-reply under a reply to someone else joins it on Replies.
 * Every other id (posts, boosts, self-replies under a top-level post) is on
 * the Posts tab.
 *
 * One recursive query for the whole page: it is seeded with the page's
 * replies and steps to each one's parent by the same actor
 * (`sameActorReplyParentMatches`, the rule `exclude_replies` uses), at most
 * `SELF_CHAIN_DEPTH_CAP` steps. The walk passes only through ancestors the
 * audience may read, so the answer depends on nothing the viewer could not
 * open beyond what `exclude_replies` already discloses (that a parent is the
 * actor's own); an unreadable ancestor, like the cap, falls back to Mastodon's
 * rule. Only the tab comes back, never an ancestor's id or content.
 */
export const getRepliesTabStatusIds = async (
  db: Db,
  { actorId, statusIds, audience }: GetRepliesTabStatusIdsParams
): Promise<string[]> => {
  const uniqueStatusIds = [...new Set(statusIds)]
  if (uniqueStatusIds.length === 0) return []

  const recipientIds = actorVisibleRecipientIds(actorId, audience)
  // 1 when the viewer may read the parent just reached. The walk only meets
  // the actor's own replies, which are Notes and Polls, so their recipients
  // decide (an Announce never carries a `reply`). The literals are inlined so
  // both union branches type the column as an integer on PostgreSQL.
  const parentReadable = recipientIds
    ? sql<number>`case when ${expressionBuilder<DB, never>().exists(
        db
          .selectFrom('recipients')
          .select(sql.lit(1).as('one'))
          .where('recipients.statusId', '=', sql.ref<string>('chain_parent.id'))
          .where('recipients.actorId', 'in', recipientIds)
      )} then 1 else 0 end`
    : sql<number>`1`

  const rows = (await db
    .withRecursive(
      'self_chain(startId, id, reply, replyHash, depth, readable)',
      (qc) =>
        qc
          .selectFrom('statuses as chain_start')
          .select([
            'chain_start.id as startId',
            'chain_start.id',
            'chain_start.reply',
            'chain_start.replyHash',
            sql<number>`0`.as('depth'),
            sql<number>`1`.as('readable')
          ])
          .where('chain_start.actorId', '=', actorId)
          .where('chain_start.id', 'in', uniqueStatusIds)
          .where((eb) =>
            eb.not(eb('chain_start.type', '=', StatusType.enum.Announce))
          )
          .where('chain_start.reply', 'is not', null)
          .where('chain_start.reply', '<>', '')
          .unionAll(
            qc
              .selectFrom('self_chain as chain_child')
              .innerJoin('statuses as chain_parent', (join) =>
                join.on((eb) =>
                  eb.or(
                    sameActorReplyParentMatches({
                      parent: 'chain_parent',
                      child: 'chain_child',
                      actorId
                    })
                  )
                )
              )
              .select([
                'chain_child.startId',
                'chain_parent.id',
                'chain_parent.reply',
                'chain_parent.replyHash',
                sql<number>`${sql.ref('chain_child.depth')} + 1`.as('depth'),
                parentReadable.as('readable')
              ])
              .where('chain_child.depth', '<', SELF_CHAIN_DEPTH_CAP)
              .where('chain_child.readable', '=', 1)
              .where('chain_child.reply', 'is not', null)
              .where('chain_child.reply', '<>', '')
          )
    )
    .selectFrom('self_chain')
    .select([
      'self_chain.startId',
      'self_chain.depth',
      'self_chain.reply',
      'self_chain.readable'
    ])
    .execute()) as ChainRow[]

  // Each start's deepest row decides. Two parents at one depth (a reply whose
  // id and url name two different rows) can disagree; Posts wins, as it does
  // under `exclude_replies`.
  const deepest = new Map<string, { depth: number; tab: ProfileTab }>()
  for (const row of rows) {
    const depth = Number(row.depth)
    const tab = tabOf(row)
    const previous = deepest.get(row.startId)
    if (
      !previous ||
      depth > previous.depth ||
      (depth === previous.depth && tab === 'posts')
    ) {
      deepest.set(row.startId, { depth, tab })
    }
  }

  return uniqueStatusIds.filter((id) => deepest.get(id)?.tab === 'replies')
}
