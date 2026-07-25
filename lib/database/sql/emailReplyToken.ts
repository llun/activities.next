import { Knex } from 'knex'
import { randomUUID } from 'node:crypto'

import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  ClaimEmailReplyTokenUseParams,
  CreateEmailReplyTokenParams,
  DeleteExpiredEmailReplyTokensParams,
  EmailReplyTokenData,
  EmailReplyTokenDatabase,
  EmailReplyTokenNotificationType,
  GetEmailReplyTokenParams
} from '@/lib/types/database/operations'

type SQLEmailReplyToken = {
  id: string
  tokenHash: string
  actorId: string
  statusId: string
  notificationType: string
  useCount: number
  lastUsedAt: number | Date | string | null
  expiresAt: number | Date | string
  createdAt: number | Date | string
}

// The column only ever holds a value this module wrote, so a total narrowing
// (rather than a throw) is enough: anything unexpected reads as 'reply', which
// is the more conservative of the two labels.
const toNotificationType = (value: string): EmailReplyTokenNotificationType =>
  value === 'mention' ? 'mention' : 'reply'

const toEmailReplyToken = (row: SQLEmailReplyToken): EmailReplyTokenData => ({
  id: row.id,
  tokenHash: row.tokenHash,
  actorId: row.actorId,
  statusId: row.statusId,
  notificationType: toNotificationType(row.notificationType),
  useCount: Number(row.useCount),
  lastUsedAt:
    row.lastUsedAt === null ? null : getCompatibleTime(row.lastUsedAt),
  expiresAt: getCompatibleTime(row.expiresAt),
  createdAt: getCompatibleTime(row.createdAt)
})

export const EmailReplyTokenSQLDatabaseMixin = (
  database: Knex
): EmailReplyTokenDatabase => ({
  async createEmailReplyToken({
    tokenHash,
    actorId,
    statusId,
    notificationType,
    expiresAt
  }: CreateEmailReplyTokenParams) {
    const id = randomUUID()
    const currentTime = new Date()
    await database('email_reply_tokens').insert({
      id,
      tokenHash,
      actorId,
      statusId,
      notificationType,
      useCount: 0,
      lastUsedAt: null,
      expiresAt: new Date(expiresAt),
      createdAt: currentTime
    })

    const row = (await database<SQLEmailReplyToken>('email_reply_tokens')
      .where({ id })
      .first()) as SQLEmailReplyToken
    return toEmailReplyToken(row)
  },

  async getEmailReplyToken({ tokenHash }: GetEmailReplyTokenParams) {
    const row = await database<SQLEmailReplyToken>('email_reply_tokens')
      .where({ tokenHash })
      .first()
    return row ? toEmailReplyToken(row) : null
  },

  async claimEmailReplyTokenUse({
    id,
    maxUses,
    now
  }: ClaimEmailReplyTokenUseParams) {
    // The ceiling and expiry are part of the WHERE, so the check and the spend
    // are one statement. Concurrent claims serialize on the row: exactly
    // `maxUses` of them can ever succeed, however many arrive at once.
    const claimed = await database('email_reply_tokens')
      .where({ id })
      .where('useCount', '<', maxUses)
      .where('expiresAt', '>', new Date(now))
      .update({ lastUsedAt: new Date(now) })
      .increment('useCount', 1)
    return claimed > 0
  },

  async deleteExpiredEmailReplyTokens({
    before
  }: DeleteExpiredEmailReplyTokensParams) {
    return database('email_reply_tokens')
      .where('expiresAt', '<', new Date(before))
      .delete()
  }
})
