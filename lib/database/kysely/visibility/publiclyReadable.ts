import {
  type Expression,
  type ExpressionBuilder,
  type SqlBool,
  sql
} from 'kysely'

import type { DB, Db } from '@/lib/database/kysely'
import { PUBLIC_ACTIVITY_RECIPIENTS } from '@/lib/database/kysely/visibility/potentiallyReadable'
import { StatusType } from '@/lib/types/domain/status'

const ANNOUNCE = StatusType.enum.Announce

// The tables a pointer or a recipient test is read from: the outer status and
// the two aliases inside the announce chain.
type ChainTable = 'statuses' | 'chain_seed' | 'chain_next'

// The status an Announce boosts, as one column: `originalStatusId`, or for a
// legacy row the id it wrote into `content`; NULL for anything that is not an
// Announce. The Announce literal is spliced in, as in the Knex
// announceOriginalPointer, so both build the same CASE.
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
// a publicly readable status that is not an Announce, every hop being
// addressed to the public collection. UNION (not UNION ALL) ends a cycle.
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
// chain reaches a public status that is not an Announce. The Kysely twin of
// wherePubliclyReadableStatus (lib/database/sql/utils/publiclyReadableStatus.ts,
// which explains when to use the correlated form and why it is one recursive
// branch); publiclyReadableStatusEquivalence.test.ts runs both, and the set
// form buildPubliclyReadableStatusIdsQuery, over the same rows.
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
