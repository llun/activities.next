import crypto from 'crypto'

import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { isActorModerationBlocked } from '@/lib/services/guards/OAuthGuard'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import {
  EmailReplyTokenData,
  EmailReplyTokenNotificationType
} from '@/lib/types/database/operations'
import { logger } from '@/lib/utils/logger'

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
 * The producer-facing entry point: returns a Reply-To address for a
 * notification email, or undefined when this notification must not be
 * repliable.
 *
 * Four gates, all of which must pass — the inbound/outbound email
 * configuration, the recipient's moderation state, the instance-wide admin
 * switch, and the recipient's own opt-in (absent means off).
 *
 * The moderation check is belt-and-braces: the job re-checks it at redemption,
 * which is the authoritative gate. Checking here too means a suspended or
 * disabled account is never sent an email advertising a capability it does not
 * have.
 *
 * Minting is a database write on a path that is otherwise pure reads, so every
 * failure is swallowed: the caller falls back to a normal, non-repliable
 * notification rather than losing the email. Both producers already treat the
 * email channel as best-effort.
 */
export const createReplyToAddress = async (
  database: Database,
  { actorId, statusId, notificationType }: MintReplyTokenParams
): Promise<string | undefined> => {
  try {
    const { email, emailInbound } = getConfig()
    if (!email || !emailInbound) return undefined

    const actor = await database.getActorFromId({ id: actorId })
    if (!actor || isActorModerationBlocked(actor)) return undefined

    const serverSettings = await getResolvedServerSettings(database)
    if (!serverSettings.replyByEmail.enabled) return undefined

    const actorSettings = await database.getActorSettings({ actorId })
    if (actorSettings?.replyByEmail !== true) return undefined

    const minted = await mintReplyToken(database, {
      actorId,
      statusId,
      notificationType
    })
    return minted?.address
  } catch (error) {
    logger.error({
      message: 'Failed to mint a reply-by-email address',
      actorId,
      statusId,
      err: error
    })
    return undefined
  }
}

/**
 * Why a token could not be used.
 *
 * `unknown` is deliberately distinct from the other two: an unknown hash gives
 * us no actor, so there is nobody to tell, while an expired or spent row still
 * names its owner and can therefore be answered instead of dropped silently.
 */
export type ReplyTokenResolution =
  | { status: 'ok'; token: EmailReplyTokenData }
  | { status: 'expired'; token: EmailReplyTokenData }
  | { status: 'exhausted'; token: EmailReplyTokenData }
  | { status: 'unknown' }

/** Look a token up by its keyed hash and say whether it may still be used. */
export const resolveReplyToken = async (
  database: Database,
  token: string
): Promise<ReplyTokenResolution> => {
  if (!REPLY_TOKEN_PATTERN.test(token)) return { status: 'unknown' }

  const row = await database.getEmailReplyToken({
    tokenHash: hashReplyToken(token)
  })
  if (!row) return { status: 'unknown' }
  if (row.expiresAt <= Date.now()) return { status: 'expired', token: row }
  if (row.useCount >= REPLY_TOKEN_MAX_USES) {
    return { status: 'exhausted', token: row }
  }

  return { status: 'ok', token: row }
}
