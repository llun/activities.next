import { sql } from 'kysely'

import type {
  CreateStatusQuoteParams,
  GetQuotingStatusIdsParams,
  GetStatusQuoteByAuthorizationUriParams,
  GetStatusQuoteByQuoteRequestIdParams,
  GetStatusQuoteParams,
  StatusQuoteRecord,
  UpdateStatusQuoteStateParams
} from '@/lib/database/domains/statusQuote/types'
import { type Db, inTransaction } from '@/lib/database/kysely'
import { pastKeyset } from '@/lib/database/kysely/keyset'
import { QuoteState } from '@/lib/types/domain/status'

type StatusQuoteRow = {
  statusId: string
  quotedStatusId: string
  state: string
  quoteRequestId: string | null
  authorizationUri: string | null
  createdAt: number | null
  updatedAt: number | null
}

const toStatusQuoteRecord = (row: StatusQuoteRow): StatusQuoteRecord => ({
  statusId: row.statusId,
  quotedStatusId: row.quotedStatusId,
  state: QuoteState.parse(row.state),
  quoteRequestId: row.quoteRequestId ?? null,
  authorizationUri: row.authorizationUri ?? null,
  // Nullable in the schema, but every writer sets both.
  createdAt: row.createdAt ?? 0,
  updatedAt: row.updatedAt ?? 0
})

// One-way quote-edge state machine (FEP-044f). A transition not listed here is a
// no-op — this makes late messages idempotent and resolves Accept-vs-Delete
// races by construction (a revoked/rejected/deleted edge never regresses).
const ALLOWED_TRANSITIONS: Record<QuoteState, QuoteState[]> = {
  pending: ['accepted', 'rejected'],
  accepted: ['revoked', 'deleted'],
  rejected: [],
  revoked: [],
  deleted: []
}

const canTransition = (from: QuoteState, to: QuoteState): boolean =>
  ALLOWED_TRANSITIONS[from].includes(to)

const selectStatusQuote = (db: Db) => db.selectFrom('status_quotes').selectAll()

const getStatusQuoteRow = (db: Db, statusId: string) =>
  selectStatusQuote(db)
    .where('statusId', '=', statusId)
    .limit(1)
    .executeTakeFirst()

export const createStatusQuote = (
  db: Db,
  {
    statusId,
    quotedStatusId,
    state = 'pending',
    quoteRequestId = null,
    authorizationUri = null
  }: CreateStatusQuoteParams
): Promise<StatusQuoteRecord> => {
  const currentTime = new Date()
  return inTransaction(db, async (trx) => {
    const existing = await getStatusQuoteRow(trx, statusId)
    if (existing) {
      await trx
        .updateTable('status_quotes')
        .set({
          quotedStatusId,
          state,
          quoteRequestId,
          authorizationUri,
          updatedAt: currentTime
        })
        .where('statusId', '=', statusId)
        .execute()
    } else {
      await trx
        .insertInto('status_quotes')
        .values({
          statusId,
          quotedStatusId,
          state,
          quoteRequestId,
          authorizationUri,
          createdAt: currentTime,
          updatedAt: currentTime
        })
        .execute()
    }
    const row = await getStatusQuoteRow(trx, statusId)
    // The row was just written in this transaction, so it always exists.
    return toStatusQuoteRecord(row as StatusQuoteRow)
  })
}

export const getStatusQuote = async (
  db: Db,
  { statusId }: GetStatusQuoteParams
): Promise<StatusQuoteRecord | null> => {
  const row = await getStatusQuoteRow(db, statusId)
  return row ? toStatusQuoteRecord(row) : null
}

export const getStatusQuoteByQuoteRequestId = async (
  db: Db,
  { quoteRequestId }: GetStatusQuoteByQuoteRequestIdParams
): Promise<StatusQuoteRecord | null> => {
  const row = await selectStatusQuote(db)
    .where('quoteRequestId', '=', quoteRequestId)
    .limit(1)
    .executeTakeFirst()
  return row ? toStatusQuoteRecord(row) : null
}

export const getStatusQuoteByAuthorizationUri = async (
  db: Db,
  { authorizationUri }: GetStatusQuoteByAuthorizationUriParams
): Promise<StatusQuoteRecord | null> => {
  // The authorizationUri index is non-unique, so a stray (e.g. forged
  // pending) edge could share a legitimate stamp uri. A stamp is only ever
  // meaningful for the `accepted` edge it belongs to, so prefer that one and
  // order deterministically to make the lookup unambiguous.
  const row = await selectStatusQuote(db)
    .where('authorizationUri', '=', authorizationUri)
    .orderBy(
      sql`case when ${sql.ref('state')} = ${sql.lit('accepted')} then 0 else 1 end`
    )
    .orderBy('statusId')
    .limit(1)
    .executeTakeFirst()
  return row ? toStatusQuoteRecord(row) : null
}

export const updateStatusQuoteState = (
  db: Db,
  { statusId, state, authorizationUri }: UpdateStatusQuoteStateParams
): Promise<StatusQuoteRecord | null> =>
  inTransaction(db, async (trx) => {
    const existing = await getStatusQuoteRow(trx, statusId)
    if (!existing) return null

    const currentState = QuoteState.parse(existing.state)
    if (!canTransition(currentState, state)) {
      // Illegal (or same-state) transition: leave the row untouched.
      return toStatusQuoteRecord(existing)
    }

    await trx
      .updateTable('status_quotes')
      .set({
        state,
        // Only overwrite the stamp uri when the caller supplies one; a
        // transition that does not carry a stamp keeps the existing value.
        ...(authorizationUri !== undefined ? { authorizationUri } : {}),
        updatedAt: new Date()
      })
      .where('statusId', '=', statusId)
      .execute()
    const row = await getStatusQuoteRow(trx, statusId)
    return toStatusQuoteRecord(row as StatusQuoteRow)
  })

export const getQuotingStatusIds = async (
  db: Db,
  {
    quotedStatusId,
    state,
    limit = 20,
    maxId,
    sinceId,
    offset
  }: GetQuotingStatusIdsParams
): Promise<string[]> => {
  let query = db
    .selectFrom('status_quotes')
    .select('statusId')
    .where('quotedStatusId', '=', quotedStatusId)
  if (state) query = query.where('state', '=', state)

  // Keyset pagination over (createdAt, statusId), newest first. The cursor
  // ids reference the quoting status id (the PK of this table).
  for (const [cursorId, operator] of [
    [maxId, '<'],
    [sinceId, '>']
  ] as const) {
    if (!cursorId) continue
    const cursor = await db
      .selectFrom('status_quotes')
      .select('createdAt')
      .where('statusId', '=', cursorId)
      .limit(1)
      .executeTakeFirst()
    if (!cursor) return []
    query = query.where((eb) =>
      pastKeyset(
        eb,
        { createdAt: cursor.createdAt ?? 0, tieBreaker: cursorId },
        operator,
        'statusId'
      )
    )
  }

  query = query.orderBy('createdAt', 'desc').orderBy('statusId', 'desc')
  query = query.limit(limit)
  if (offset) query = query.offset(offset)

  const rows = await query.execute()
  return rows.map((row) => row.statusId)
}

// The facade getSQLDatabase binds with bindDb().
export const statusQuoteQueries = {
  createStatusQuote,
  getStatusQuote,
  getStatusQuoteByQuoteRequestId,
  getStatusQuoteByAuthorizationUri,
  updateStatusQuoteState,
  getQuotingStatusIds
}
