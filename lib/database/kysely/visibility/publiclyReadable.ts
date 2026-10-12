import {
  type Expression,
  type ExpressionBuilder,
  type SelectQueryBuilder,
  type SqlBool,
  sql
} from 'kysely'

import type { DB, Db } from '@/lib/database/kysely'
import { PUBLIC_ACTIVITY_RECIPIENTS } from '@/lib/database/kysely/visibility/potentiallyReadable'
import { StatusType } from '@/lib/types/domain/status'

const ANNOUNCE = StatusType.enum.Announce

// The tables a pointer or a recipient test is read from: the outer status and
// the two aliases inside the announce chain, and the two aliases of the set
// form's recursion.
type ChainTable =
  | 'statuses'
  | 'chain_seed'
  | 'chain_next'
  | 'target_statuses'
  | 'original_statuses'

// The status an Announce boosts, as one column. Modern rows carry it in
// `originalStatusId`; legacy rows only ever wrote the original's id into
// `content`, so both forms collapse into one `COALESCE`. Anything that is not
// an Announce points nowhere, and a NULL pointer joins to no row, which is
// what makes this equivalent to spelling the two forms out as an `OR` in the
// join condition, while costing one primary-key probe instead of a `BitmapOr`
// of two, and keeping the wide `content` text out of the recursion's working
// table. The Announce literal is inlined rather than bound, so nothing bound
// sits inside the CASE (statusReadableSql.test.ts pins that).
const announceOriginalPointer = (table: ChainTable) =>
  sql<
    string | null
  >`case when ${sql.ref(`${table}.type`)} = ${sql.lit(ANNOUNCE)} then coalesce(${sql.ref(`${table}.originalStatusId`)}, ${sql.ref(`${table}.content`)}) end`

// "Addressed to the public collection", correlated to `statusIdColumn`: the
// subquery of an EXISTS.
const publicRecipients = (db: Db, statusIdColumn: `${ChainTable}.id`) =>
  db
    .selectFrom('recipients')
    .select(sql.lit(1).as('one'))
    .where('recipients.statusId', '=', sql.ref<string>(statusIdColumn))
    .where('recipients.actorId', 'in', PUBLIC_ACTIVITY_RECIPIENTS)

// Whether the Announce chain that starts at the outer status's pointer reaches
// a publicly readable status that is not an Announce. Every hop must itself be
// addressed to the public collection: an Announce is publicly readable only
// while the status it boosts still is, and that status belongs to a different
// actor whose visibility edits never touch this row. UNION (not UNION ALL)
// ends a cycle: a boost chain that loops back on itself re-derives a row
// already in the working table and the recursion stops. Remote input can
// produce one; nothing local does.
const announceChainReachesPublicNote = (db: Db) =>
  db
    .withRecursive('announce_chain(id, type, originalPointer)', (qc) =>
      qc
        .selectFrom('statuses as chain_seed')
        .select([
          'chain_seed.id',
          'chain_seed.type',
          announceOriginalPointer('chain_seed').as('originalPointer')
        ])
        .where('chain_seed.id', '=', announceOriginalPointer('statuses'))
        .where((eb) => eb.exists(publicRecipients(db, 'chain_seed.id')))
        .union(
          qc
            .selectFrom('statuses as chain_next')
            .innerJoin(
              'announce_chain as chain_previous',
              'chain_previous.originalPointer',
              'chain_next.id'
            )
            .select([
              'chain_next.id',
              'chain_next.type',
              announceOriginalPointer('chain_next').as('originalPointer')
            ])
            .where('chain_previous.type', '=', ANNOUNCE)
            .where((eb) => eb.exists(publicRecipients(db, 'chain_next.id')))
        )
    )
    .selectFrom('announce_chain')
    .select(sql.lit(1).as('one'))
    .where((eb) => eb.not(eb('announce_chain.type', '=', ANNOUNCE)))

// "This status is publicly readable", correlated to the `statuses` row of the
// outer query: addressed to the public collection and, for an Announce, its
// chain reaches a public status that is not an Announce.
//
// Reach for this form when the number of rows the predicate is evaluated over
// is bounded, by a LIMIT or by the query's own scope being small. The set form
// publiclyReadableStatusIds below computes the same answer as a materialised id
// set, which the planner must finish before a LIMIT sees a single row: on a
// PostgreSQL 18 seed shaped like production that put the anonymous profile
// page's 30-row query at 33,308-33,311 buffers for every page size, against
// 325/476/573 here at limits of 20/30/40. Keep the set form when the predicate
// has to be evaluated over a large unbounded set anyway (a COUNT cannot
// amortise the per-Announce recursive CTE the way a LIMIT does; see
// getActorStatusesCount), or when the query embeds it more than once (see
// getRebloggedBy). Being unlimited is not by itself disqualifying:
// getStatusRepliesCount is an unbounded COUNT over one status's replies and
// measures the same either way.
//
// The two disjuncts are not interchangeable with a "check depth 1 first, then
// recurse" fast path: spelling the common case as its own correlated EXISTS
// lets PostgreSQL decorrelate it into a hashed SubPlan that scans every
// non-Announce status in the instance (476 buffers became 11,294, 0.63ms
// became 82ms on the same seed). The recursive CTE resists that rewrite, which
// is why this reads as one branch.
//
// publiclyReadable.test.ts runs it beside the set form over the same rows, and
// statusReadableSql.test.ts pins its compiled SQL.
export const publiclyReadableStatus = (
  db: Db,
  eb: ExpressionBuilder<DB, 'statuses'>
): Expression<SqlBool> =>
  eb.and([
    eb.exists(publicRecipients(db, 'statuses.id')),
    eb.or([
      eb.not(eb('statuses.type', '=', ANNOUNCE)),
      eb.exists(announceChainReachesPublicNote(db))
    ])
  ])

// The ids of the statuses addressed to the public collection, as the
// uncorrelated subquery of an `in` list.
const publicRecipientStatusIds = (db: Db) =>
  db
    .selectFrom('recipients')
    .select('recipients.statusId')
    .where('recipients.actorId', 'in', PUBLIC_ACTIVITY_RECIPIENTS)

/**
 * The ids among `targetStatusIds` (a query selecting one `id` column) that
 * are publicly readable, as a set: one recursive CTE seeded with the whole
 * target set walks every Announce chain at once, with the `'Announce'`
 * literal inlined in the chain pointer, one pointer equality per hop and
 * `UNION`. publiclyReadable.test.ts runs it beside the correlated form over
 * the same rows, and statusReadableSql.test.ts pins its compiled SQL.
 *
 * Use it where the correlated publiclyReadableStatus would be evaluated over a
 * large set or more than once per row (getRebloggedBy embeds it twice, and
 * getActorStatusesCount counts an actor's whole history; see the notes
 * there); the correlated form is the one a LIMIT can bound.
 */
export const publiclyReadableStatusIds = (
  db: Db,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  targetStatusIds: SelectQueryBuilder<DB, any, { id: string }>
) =>
  db
    .withRecursive(
      'publicly_readable_statuses(targetId, id, type, originalPointer)',
      (qc) =>
        qc
          .selectFrom(targetStatusIds.as('target_status_ids'))
          .innerJoin(
            'statuses as target_statuses',
            'target_statuses.id',
            'target_status_ids.id'
          )
          .select([
            'target_statuses.id as targetId',
            'target_statuses.id',
            'target_statuses.type',
            announceOriginalPointer('target_statuses').as('originalPointer')
          ])
          .where('target_statuses.id', 'in', publicRecipientStatusIds(db))
          .union(
            qc
              .selectFrom('statuses as original_statuses')
              .innerJoin(
                'publicly_readable_statuses as readable_statuses',
                'readable_statuses.originalPointer',
                'original_statuses.id'
              )
              .select([
                'readable_statuses.targetId',
                'original_statuses.id',
                'original_statuses.type',
                announceOriginalPointer('original_statuses').as(
                  'originalPointer'
                )
              ])
              .where('readable_statuses.type', '=', ANNOUNCE)
              .where('original_statuses.id', 'in', publicRecipientStatusIds(db))
          )
    )
    .selectFrom('publicly_readable_statuses')
    .select('publicly_readable_statuses.targetId as id')
    .where((eb) => eb.not(eb('publicly_readable_statuses.type', '=', ANNOUNCE)))
