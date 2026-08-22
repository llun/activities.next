import { Knex } from 'knex'

import { PUBLIC_ACTIVITY_RECIPIENTS } from '@/lib/database/sql/utils/statusVisibility'
import { StatusType } from '@/lib/types/domain/status'

// The status an Announce boosts, as a single column. Modern rows carry it in
// `originalStatusId`; legacy rows only ever wrote the original's id into
// `content`, so both forms collapse into one `COALESCE`. Anything that is not
// an Announce points nowhere, and a NULL pointer joins to no row — which is
// what makes this equivalent to spelling the two forms out as an `OR` in the
// join condition, while costing one primary-key probe instead of a `BitmapOr`
// of two, and keeping the wide `content` text out of the recursion's working
// table.
//
// The Announce literal is escaped into the fragment instead of bound, because
// knex mis-orders positional bindings when a term of a UNION'd CTE carries both
// a bound raw in its select list and a bound subquery in its FROM: the FROM's
// value is emitted first, so the two swap and the CASE silently compares the
// status type against the caller's target-set argument. The recursive branch of
// `buildPubliclyReadableStatusIdsQuery` is exactly that shape. Identifier
// placeholders are unaffected — they are resolved at compile time and never
// reach the binding array. Guarded by a compiled-SQL test.
//
// Shared by BOTH readability forms — the set-based
// `buildPubliclyReadableStatusIdsQuery` and the correlated
// `wherePubliclyReadableStatus` below — and by all three dialect branches
// between them. That sharing is the only thing keeping the branches from
// drifting, since MySQL has no CI coverage at all.
export const announceOriginalPointer = (database: Knex, table: string) => {
  const announceType = database.raw('?', [StatusType.enum.Announce]).toString()
  return database.raw(
    `case when ?? = ${announceType} then coalesce(??, ??) end`,
    [`${table}.type`, `${table}.originalStatusId`, `${table}.content`]
  )
}

// "Addressed to the public collection", correlated to one status row.
//
// Spelled as an EXISTS rather than the set-based
// `id IN (SELECT statusId FROM recipients …)` the count path uses, because the
// point of this whole module's correlated form is that nothing materialises
// ahead of the outer row. On PostgreSQL this is served by
// `recipients_actorId_statusId_idx` at `Heap Fetches: 0`.
const publicRecipientExistsQuery = (database: Knex, statusIdColumn: string) =>
  database
    .select(database.raw('1'))
    .from('recipients')
    .whereRaw('?? = ??', ['recipients.statusId', statusIdColumn])
    .whereIn('recipients.actorId', PUBLIC_ACTIVITY_RECIPIENTS)

// Does the Announce chain starting at `table`'s pointer reach a publicly
// readable non-Announce?
//
// Every hop must itself be addressed to the public collection: an Announce is
// publicly readable only while the status it boosts still is, and that status
// belongs to a different actor whose visibility edits never touch this row.
// `UNION` rather than `UNION ALL` is what terminates a cycle — a boost chain
// that loops back on itself re-derives a row already in the working table and
// the recursion stops. Remote input can produce one; nothing local does.
const announceChainReachesPublicNote = (database: Knex, table: string) =>
  database
    .withRecursive(
      'announce_chain',
      ['id', 'type', 'originalPointer'],
      (cte) => {
        cte
          .select(
            'chain_seed.id',
            'chain_seed.type',
            announceOriginalPointer(database, 'chain_seed')
          )
          .from('statuses as chain_seed')
          // The outer row's own pointer. This is the correlated reference that
          // makes the whole predicate per-row; both PostgreSQL and SQLite
          // accept an outer column inside a subquery's recursive CTE.
          .where('chain_seed.id', announceOriginalPointer(database, table))
          .whereExists(publicRecipientExistsQuery(database, 'chain_seed.id'))
          .union((qb) => {
            qb.select(
              'chain_next.id',
              'chain_next.type',
              announceOriginalPointer(database, 'chain_next')
            )
              .from('statuses as chain_next')
              .innerJoin(
                'announce_chain as chain_previous',
                'chain_previous.originalPointer',
                'chain_next.id'
              )
              .where('chain_previous.type', StatusType.enum.Announce)
              .whereExists(
                publicRecipientExistsQuery(database, 'chain_next.id')
              )
          })
      }
    )
    .select(database.raw('1'))
    .from('announce_chain')
    .whereNot('announce_chain.type', StatusType.enum.Announce)

// MySQL cannot correlate a CTE inside a subquery, so its chain is one hop and
// stops there: a boosted boost is answered "not publicly readable" where the
// recursive branch walks the chain and answers "yes". That gap predates this
// module — `buildPubliclyReadableStatusIdsQuery`'s MySQL branch has always had
// it — and MySQL has no CI coverage, so nothing will tell you if it ever
// matters. Only the chain forks; the recipient test and the pointer are shared.
const announceOriginalIsPublicNote = (database: Knex, table: string) =>
  database
    .select(database.raw('1'))
    .from('statuses as original_statuses')
    .where('original_statuses.id', announceOriginalPointer(database, table))
    .whereNot('original_statuses.type', StatusType.enum.Announce)
    .whereExists(publicRecipientExistsQuery(database, 'original_statuses.id'))

// "This status is publicly readable", as a predicate correlated to the row the
// outer query is already looking at.
//
// Written for knex's `modify`, which keeps it chainable mid-builder:
//
//     query.modify(wherePubliclyReadableStatus, database)
//     query.modify(wherePubliclyReadableStatus, database, 'reply_statuses')
//
// This is the form for any query a LIMIT bounds. The set-based
// `buildPubliclyReadableStatusIdsQuery` computes the same answer as a materialised
// id set, which the planner must finish before a LIMIT sees a single row — on a
// PostgreSQL 18 seed shaped like production that put the anonymous profile
// page's 30-row query at 33,308-33,311 buffers for every page size, against
// 325/476/573 here at limits of 20/30/40. Keep the set form only where the
// query has to touch every row anyway; see the note at `getActorStatusesCount`.
//
// The two disjuncts are NOT interchangeable with a "check depth 1 first, then
// recurse" fast path. Spelling the common case as its own correlated EXISTS
// lets PostgreSQL decorrelate it into a hashed SubPlan: it sequentially scans
// every non-Announce status in the instance and hashes every public recipient
// row to answer one page. Measured on the same seed, that turned 476 buffers
// into 11,294 and 0.63ms into 82ms. The recursive CTE resists that rewrite,
// which is the only reason this reads as one branch rather than two.
export const wherePubliclyReadableStatus = (
  query: Knex.QueryBuilder,
  database: Knex,
  table: string = 'statuses'
): void => {
  const clientName = String(database.client.config.client)
  const announceChain = clientName.includes('mysql')
    ? announceOriginalIsPublicNote(database, table)
    : announceChainReachesPublicNote(database, table)

  query
    .whereExists(publicRecipientExistsQuery(database, `${table}.id`))
    .where((builder) => {
      builder
        .whereNot(`${table}.type`, StatusType.enum.Announce)
        .orWhereExists(announceChain)
    })
}
