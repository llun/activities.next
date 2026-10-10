import type { ExpressionBuilder } from 'kysely'

import type { DB } from '@/lib/database/kysely'

// "This server hosts this actor": it holds the actor's signing key. Rows
// written by older remote-recording paths store an empty string rather than
// NULL, so both halves are needed. The Kysely twin of whereLocalActor
// (lib/database/sql/utils/localActor.ts, which explains the history).
export const isLocalActor = (eb: ExpressionBuilder<DB, 'actors'>) =>
  eb.and([
    eb('actors.privateKey', 'is not', null),
    eb('actors.privateKey', '<>', '')
  ])
