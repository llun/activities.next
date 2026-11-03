import { expressionBuilder, sql } from 'kysely'

import { sameActorReplyParentMatches } from '@/lib/database/domains/status/replyParent'
import type { GetRepliesTabStatusIdsParams } from '@/lib/database/domains/status/types'
import type { DB, Db } from '@/lib/database/kysely'
import { actorVisibleRecipientIds } from '@/lib/database/kysely/visibility/actorVisible'
import { StatusType } from '@/lib/types/domain/status'

/**
 * How many steps up the actor's self-reply chain `getRepliesTabStatusIds`
 * follows. A chain of this many steps is still classified from its first
 * post; one longer than this falls back to Mastodon's rule (a reply to one's
 * own post is not a reply), which puts it on the Posts tab. It also bounds a
 * chain that loops back on itself.
 */
export const SELF_CHAIN_DEPTH_CAP = 20

type SelfChainRow = {
  startId: string
  depth: number | string
  reply: string | null
  readable: number | string
}

type ProfileTab = 'posts' | 'replies'

// The tab one walked row decides, for the deepest row of its chain.
const tabOf = (row: SelfChainRow): ProfileTab => {
  const depth = Number(row.depth)
  // The page's own reply, with no parent by the same actor: a reply to
  // someone else, or to a parent this server does not have.
  if (depth === 0) return 'replies'
  // An ancestor the viewer cannot read ends the walk. Its being the actor's
  // own post is what `exclude_replies` already tells anyone, so the chain
  // counts as Mastodon counts it: not a reply.
  if (Number(row.readable) !== 1) return 'posts'
  // Past the cap: the chain is longer than `SELF_CHAIN_DEPTH_CAP` steps, so
  // Mastodon's rule again.
  if (depth > SELF_CHAIN_DEPTH_CAP) return 'posts'
  // The chain's first post is a top-level post.
  if (!row.reply) return 'posts'
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
 * One recursive query for the whole page (`selectSelfChainRows`): it is
 * seeded with the page's replies and steps to each one's parent by the same
 * actor (`sameActorReplyParentMatches`, the rule `exclude_replies` uses), one
 * step past `SELF_CHAIN_DEPTH_CAP` so a chain of exactly that many steps is
 * still decided by its first post. The walk passes only through ancestors the
 * audience may read, so the answer depends on nothing the viewer could not
 * open beyond what `exclude_replies` already discloses (that a parent is the
 * actor's own); an unreadable ancestor, like the cap, falls back to Mastodon's
 * rule. Only the tab comes back, never an ancestor's id or content.
 */
export const getRepliesTabStatusIds = async (
  db: Db,
  params: GetRepliesTabStatusIdsParams
): Promise<string[]> => {
  const uniqueStatusIds = [...new Set(params.statusIds)]
  if (uniqueStatusIds.length === 0) return []

  const rows = await selectSelfChainRows(db, {
    ...params,
    statusIds: uniqueStatusIds
  })

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

/**
 * The walked rows behind `getRepliesTabStatusIds`, one per (page reply,
 * ancestor, depth). Exported for its row-count regression test only.
 *
 * The recursive step is a `UNION`, not `UNION ALL`, and that is what bounds
 * the walk. A reply can name two of the actor's statuses at once (one whose
 * `id` and another whose `url` equal its `reply`, which a remote server can
 * craft), so with `UNION ALL` a ladder of such pairs doubles the rows at each
 * step: 2^depth rows per seed. Every column of a row is a function of
 * (startId, parent id, depth): `reply` and `replyHash` are the parent's own,
 * and `readable` depends only on the parent's recipients and the fixed
 * audience. So `UNION` keeps at most one row per (startId, status, depth), and
 * a seed yields at most (SELF_CHAIN_DEPTH_CAP + 2) depths × (the most
 * distinct statuses at any one depth) rows: linear in the chain, never
 * exponential (an id/url ladder two wide gives two per depth). Keep it that
 * way: a new column that is not a function of those three would let
 * duplicates back in.
 */
export const selectSelfChainRows = async (
  db: Db,
  { actorId, statusIds, audience }: GetRepliesTabStatusIdsParams
): Promise<SelfChainRow[]> => {
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

  return (await db
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
          .where('chain_start.id', 'in', statusIds)
          .where((eb) =>
            eb.not(eb('chain_start.type', '=', StatusType.enum.Announce))
          )
          .where('chain_start.reply', 'is not', null)
          .where('chain_start.reply', '<>', '')
          // `UNION` dedupes paths that reach one parent at one depth; see
          // the function's comment for why this bounds the walk.
          .union(
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
              // One step past the cap, so a row deeper than the cap marks a
              // chain longer than it.
              .where('chain_child.depth', '<=', SELF_CHAIN_DEPTH_CAP)
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
    .execute()) as SelfChainRow[]
}
