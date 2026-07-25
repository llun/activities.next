import crypto from 'crypto'

import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import {
  EmailReplyTokenData,
  EmailReplyTokenNotificationType
} from '@/lib/types/database/operations'

import { parseEmailAddress, splitEmailAddress } from './address'

// 128 bits, base64url-encoded to 22 characters. With the default `reply`
// prefix the whole local part is 28 characters, comfortably inside the 64-char
// limit even if an operator picks a longer prefix.
const REPLY_TOKEN_BYTES = 16

// A token stays valid for a month. Long enough that replying to an old
// notification still works, short enough that a token leaked through a
// forwarded mail thread stops working on its own.
export const REPLY_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000

// Tokens are deliberately reusable — people reply twice to the same
// notification and mail clients retry sends, so burning the token on first use
// would silently drop the second reply. This ceiling is what bounds abuse of a
// leaked token instead. Duplicate *deliveries* of one message are a different
// problem, solved by the per-message idempotency key in the job.
export const REPLY_TOKEN_MAX_USES = 20

// base64url alphabet, bounded so nothing unbounded reaches the HMAC.
const REPLY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export interface MintReplyTokenParams {
  actorId: string
  statusId: string
  notificationType: EmailReplyTokenNotificationType
}

export interface MintedReplyToken {
  token: string
  address: string
}

/**
 * Hash a reply token for storage and lookup.
 *
 * Same reasoning as `hashPasswordResetCode`: the token is 128 bits of
 * randomness rather than a user-chosen secret, so a slow password KDF buys
 * nothing. HMAC-SHA256 keyed with the server secret is deterministic (so the
 * digest works as a lookup key) and means a leaked database alone cannot be
 * turned into a working reply address — the raw token only ever exists in the
 * sent email.
 */
export const hashReplyToken = (token: string): string =>
  crypto
    .createHmac('sha256', getConfig().secretPhase)
    .update(token)
    .digest('hex')

/**
 * Pull the reply token out of a recipient address, or null when the address is
 * not one of ours. The domain and the prefix compare case-insensitively; the
 * token itself does not, because the local part is case-sensitive per RFC 5321
 * and the token is base64url.
 */
export const extractReplyTokenFromAddress = (
  address: string
): string | null => {
  const { emailInbound } = getConfig()
  if (!emailInbound) return null

  const parsed = parseEmailAddress(address)
  if (!parsed) return null

  const split = splitEmailAddress(parsed)
  if (!split) return null
  if (split.domain !== emailInbound.domain.toLowerCase()) return null

  const separator = split.localPart.indexOf('+')
  if (separator <= 0) return null
  if (
    split.localPart.slice(0, separator).toLowerCase() !==
    emailInbound.localPartPrefix.toLowerCase()
  ) {
    return null
  }

  const token = split.localPart.slice(separator + 1)
  return REPLY_TOKEN_PATTERN.test(token) ? token : null
}

// An inbound message lists every recipient, most of which are not ours (the
// original sender, other participants in the thread). Return the first address
// that is.
export const findReplyTokenInRecipients = (
  recipients: string[]
): string | null => {
  for (const recipient of recipients) {
    const token = extractReplyTokenFromAddress(recipient)
    if (token) return token
  }
  return null
}

export const mintReplyToken = async (
  database: Database,
  { actorId, statusId, notificationType }: MintReplyTokenParams
): Promise<MintedReplyToken | null> => {
  const { emailInbound } = getConfig()
  if (!emailInbound) return null

  const token = crypto.randomBytes(REPLY_TOKEN_BYTES).toString('base64url')
  await database.createEmailReplyToken({
    tokenHash: hashReplyToken(token),
    actorId,
    statusId,
    notificationType,
    expiresAt: Date.now() + REPLY_TOKEN_TTL_MS
  })

  return {
    token,
    address: `${emailInbound.localPartPrefix}+${token}@${emailInbound.domain}`
  }
}

/**
 * Look a token up by its keyed hash, rejecting rows that have expired or spent
 * their use ceiling. Returns null in every failure case — the caller cannot
 * distinguish "never existed" from "expired", which is the point.
 */
export const resolveReplyToken = async (
  database: Database,
  token: string
): Promise<EmailReplyTokenData | null> => {
  if (!REPLY_TOKEN_PATTERN.test(token)) return null

  const row = await database.getEmailReplyToken({
    tokenHash: hashReplyToken(token)
  })
  if (!row) return null
  if (row.expiresAt <= Date.now()) return null
  if (row.useCount >= REPLY_TOKEN_MAX_USES) return null

  return row
}
