import { Knex } from 'knex'

import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  CreateStatusQuoteParams,
  GetQuotingStatusIdsParams,
  GetStatusQuoteByAuthorizationUriParams,
  GetStatusQuoteByQuoteRequestIdParams,
  GetStatusQuoteParams,
  MarkQuotesDeletedByQuotedStatusIdParams,
  StatusQuoteDatabase,
  StatusQuoteRecord,
  UpdateStatusQuoteStateParams
} from '@/lib/types/database/operations'
import { QuoteState } from '@/lib/types/domain/status'

type StatusQuoteRow = {
  statusId: string
  quotedStatusId: string
  state: string
  quoteRequestId: string | null
  authorizationUri: string | null
  createdAt: number | Date | string
  updatedAt: number | Date | string
}

const fixStatusQuoteRow = (row: StatusQuoteRow): StatusQuoteRecord => ({
  statusId: row.statusId,
  quotedStatusId: row.quotedStatusId,
  state: QuoteState.parse(row.state),
  quoteRequestId: row.quoteRequestId ?? null,
  authorizationUri: row.authorizationUri ?? null,
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt)
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

const STATUS_QUOTE_CURSOR_COLUMNS = [
  'statusId',
  'quotedStatusId',
  'state',
  'quoteRequestId',
  'authorizationUri',
  'createdAt',
  'updatedAt'
] as const

export const StatusQuoteSQLDatabaseMixin = (
  database: Knex
): StatusQuoteDatabase => {
  const getStatusQuoteRow = (
    db: Knex | Knex.Transaction,
    statusId: string
  ): Promise<StatusQuoteRow | undefined> =>
    db<StatusQuoteRow>('status_quotes')
      .where('statusId', statusId)
      .first(...STATUS_QUOTE_CURSOR_COLUMNS)

  return {
    async createStatusQuote({
      statusId,
      quotedStatusId,
      state = 'pending',
      quoteRequestId = null,
      authorizationUri = null
    }: CreateStatusQuoteParams): Promise<StatusQuoteRecord> {
      const currentTime = new Date()
      return database.transaction(async (trx) => {
        const existing = await getStatusQuoteRow(trx, statusId)
        if (existing) {
          await trx('status_quotes').where('statusId', statusId).update({
            quotedStatusId,
            state,
            quoteRequestId,
            authorizationUri,
            updatedAt: currentTime
          })
        } else {
          await trx('status_quotes').insert({
            statusId,
            quotedStatusId,
            state,
            quoteRequestId,
            authorizationUri,
            createdAt: currentTime,
            updatedAt: currentTime
          })
        }
        const row = await getStatusQuoteRow(trx, statusId)
        // The row was just written in this transaction, so it always exists.
        return fixStatusQuoteRow(row as StatusQuoteRow)
      })
    },

    async getStatusQuote({
      statusId
    }: GetStatusQuoteParams): Promise<StatusQuoteRecord | null> {
      const row = await getStatusQuoteRow(database, statusId)
      return row ? fixStatusQuoteRow(row) : null
    },

    async getStatusQuoteByQuoteRequestId({
      quoteRequestId
    }: GetStatusQuoteByQuoteRequestIdParams): Promise<StatusQuoteRecord | null> {
      const row = await database<StatusQuoteRow>('status_quotes')
        .where('quoteRequestId', quoteRequestId)
        .first(...STATUS_QUOTE_CURSOR_COLUMNS)
      return row ? fixStatusQuoteRow(row) : null
    },

    async getStatusQuoteByAuthorizationUri({
      authorizationUri
    }: GetStatusQuoteByAuthorizationUriParams): Promise<StatusQuoteRecord | null> {
      const row = await database<StatusQuoteRow>('status_quotes')
        .where('authorizationUri', authorizationUri)
        .first(...STATUS_QUOTE_CURSOR_COLUMNS)
      return row ? fixStatusQuoteRow(row) : null
    },

    async markQuotesDeletedByQuotedStatusId({
      quotedStatusId
    }: MarkQuotesDeletedByQuotedStatusIdParams): Promise<number> {
      // Only edges that could still render the quoted status (pending/accepted)
      // move to `deleted`; already-terminal edges (rejected/revoked/deleted)
      // stay put, matching the one-way state machine.
      return database('status_quotes')
        .where('quotedStatusId', quotedStatusId)
        .whereIn('state', ['pending', 'accepted'])
        .update({ state: 'deleted', updatedAt: new Date() })
    },

    async updateStatusQuoteState({
      statusId,
      state,
      authorizationUri
    }: UpdateStatusQuoteStateParams): Promise<StatusQuoteRecord | null> {
      return database.transaction(async (trx) => {
        const existing = await getStatusQuoteRow(trx, statusId)
        if (!existing) return null

        const currentState = QuoteState.parse(existing.state)
        if (!canTransition(currentState, state)) {
          // Illegal (or same-state) transition: leave the row untouched.
          return fixStatusQuoteRow(existing)
        }

        await trx('status_quotes')
          .where('statusId', statusId)
          .update({
            state,
            // Only overwrite the stamp uri when the caller supplies one; a
            // transition that does not carry a stamp keeps the existing value.
            ...(authorizationUri !== undefined ? { authorizationUri } : {}),
            updatedAt: new Date()
          })
        const row = await getStatusQuoteRow(trx, statusId)
        return fixStatusQuoteRow(row as StatusQuoteRow)
      })
    },

    async getQuotingStatusIds({
      quotedStatusId,
      state,
      limit = 20,
      maxId,
      sinceId
    }: GetQuotingStatusIdsParams): Promise<string[]> {
      const query = database<StatusQuoteRow>('status_quotes')
        .where('quotedStatusId', quotedStatusId)
        .limit(limit)
      if (state) query.where('state', state)

      // Keyset pagination over (createdAt, statusId), newest first. The cursor
      // ids reference the quoting status id (the PK of this table).
      if (maxId) {
        const cursor = await database<StatusQuoteRow>('status_quotes')
          .where('statusId', maxId)
          .first('createdAt')
        if (!cursor) return []
        query.andWhere((builder) => {
          builder.where('createdAt', '<', cursor.createdAt).orWhere((tie) => {
            tie
              .where('createdAt', cursor.createdAt)
              .andWhere('statusId', '<', maxId)
          })
        })
      }
      if (sinceId) {
        const cursor = await database<StatusQuoteRow>('status_quotes')
          .where('statusId', sinceId)
          .first('createdAt')
        if (!cursor) return []
        query.andWhere((builder) => {
          builder.where('createdAt', '>', cursor.createdAt).orWhere((tie) => {
            tie
              .where('createdAt', cursor.createdAt)
              .andWhere('statusId', '>', sinceId)
          })
        })
      }

      const rows = await query
        .orderBy('createdAt', 'desc')
        .orderBy('statusId', 'desc')
        .select('statusId')
      return rows.map((row) => row.statusId)
    }
  }
}
