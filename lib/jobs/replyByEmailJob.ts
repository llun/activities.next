import crypto from 'crypto'
import { z } from 'zod'

import { createNoteFromUserInput } from '@/lib/actions/createNote'
import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { sendMail } from '@/lib/services/email'
import { parseEmailAddress } from '@/lib/services/email/address'
import { extractReplyText } from '@/lib/services/email/extractReplyText'
import { InboundEmailAttachment } from '@/lib/services/email/inboundPayload'
import {
  REPLY_TOKEN_MAX_USES,
  resolveReplyToken
} from '@/lib/services/email/replyToken'
import {
  ReplyByEmailFailureReason,
  buildReplyByEmailFailureEmail
} from '@/lib/services/email/templates/replyByEmailFailure'
import { isActorModerationBlocked } from '@/lib/services/guards/OAuthGuard'
import { MAX_STORED_MEDIA_ATTACHMENTS } from '@/lib/services/mastodon/constants'
import { saveMedia } from '@/lib/services/medias'
import { ACCEPTED_FILE_TYPES } from '@/lib/services/medias/constants'
import { sanitizeStoredFileName } from '@/lib/services/medias/fileName'
import { exceedsMaxMediaUploadSize } from '@/lib/services/medias/uploadSizeLimit'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { validateStatusContentLimits } from '@/lib/services/statuses/contentLimits'
import { getAttachmentsFromMediaIds } from '@/lib/services/statuses/mediaIds'
import { Actor } from '@/lib/types/domain/actor'
import { PostBoxAttachment } from '@/lib/types/domain/attachment'
import { getOriginalStatus } from '@/lib/types/domain/status'
import { logger } from '@/lib/utils/logger'
import { normalizeEmail } from '@/lib/utils/normalizeEmail'

import { createJobHandle } from './createJobHandle'
import { REPLY_BY_EMAIL_JOB_NAME } from './names'

export const ReplyByEmailJobData = z.object({
  token: z.string(),
  from: z.string().optional(),
  messageId: z.string().optional(),
  text: z.string().optional(),
  html: z.string().optional(),
  attachments: z.array(InboundEmailAttachment).optional()
})
export type ReplyByEmailJobData = z.infer<typeof ReplyByEmailJobData>

const IDEMPOTENCY_KEY_PREFIX = 'email-reply:'

const sha256 = (value: string) =>
  crypto.createHash('sha256').update(value).digest('hex')

/**
 * A key that is stable across duplicate deliveries of one message.
 *
 * Providers retry aggressively, so `Message-Id` is the natural identity. When
 * a provider omits it, fall back to hashing the payload itself — a retry of the
 * same message hashes the same way, while a genuine second reply differs in its
 * body and gets its own key.
 */
const idempotencyKeyFor = (data: ReplyByEmailJobData) =>
  IDEMPOTENCY_KEY_PREFIX +
  sha256(
    data.messageId ??
      // A separator that cannot occur in any of the three parts, so
      // ('a', 'b') and ('ab', '') cannot hash to the same key.
      [data.token, data.text ?? '', data.html ?? ''].join('\u0000')
  )

const notifyFailure = async (
  actor: Actor,
  reason: ReplyByEmailFailureReason,
  statusUrl?: string
) => {
  const { email } = getConfig()
  const recipient = actor.account?.email
  if (!email || !recipient) return

  try {
    // Deliberately no replyTo: a notice about a failed reply must not itself be
    // repliable, or a misconfigured mailbox could bounce it around the loop.
    const { subject, text, html } = buildReplyByEmailFailureEmail({
      reason,
      recipientEmail: recipient,
      statusUrl
    })
    await sendMail({
      from: email.serviceFromAddress,
      to: [recipient],
      subject,
      content: { text, html }
    })
  } catch (error) {
    logger.error({
      message: 'Failed to send a reply-by-email failure notice',
      actorId: actor.id,
      err: error
    })
  }
}

const isQuotedInlineImage = (
  attachment: InboundEmailAttachment,
  html?: string
) => {
  // Angle brackets are part of the Content-ID header syntax, not the id.
  const contentId = attachment.contentId?.replace(/^<|>$/g, '')
  if (!contentId || !html) return false
  return html.includes(`cid:${contentId}`)
}

/**
 * Turn the payload's base64 parts into stored media.
 *
 * Email carries a lot the media pipeline does not accept — PDFs, inline GIFs,
 * calendar invites — so an unusable part is dropped rather than failing the
 * whole reply. Losing a signature logo must not cost someone their post.
 */
const storeAttachments = async (
  database: Database,
  actor: Actor,
  attachments: InboundEmailAttachment[],
  html?: string
): Promise<PostBoxAttachment[]> => {
  const usable = attachments.filter((attachment) => {
    if (!ACCEPTED_FILE_TYPES.includes(attachment.contentType)) return false
    // Skip a part only when the body actually references it with `cid:` — a
    // signature logo, or an image embedded in the quoted history. Treating
    // every inline part as decoration instead lost real photos: Apple Mail and
    // iOS Mail mark a picture someone deliberately attached as inline too, so
    // the reply posted as text only and nothing said why.
    return !isQuotedInlineImage(attachment, html)
  })
  if (usable.length === 0) return []

  const mediaIds: string[] = []
  for (const attachment of usable.slice(0, MAX_STORED_MEDIA_ATTACHMENTS)) {
    try {
      const buffer = Buffer.from(attachment.contentBase64, 'base64')
      if (buffer.byteLength === 0) continue
      if (await exceedsMaxMediaUploadSize([buffer.byteLength], database)) {
        logger.warn({
          message: 'Dropped an oversized reply-by-email attachment',
          actorId: actor.id,
          contentType: attachment.contentType,
          size: buffer.byteLength
        })
        continue
      }

      const file = new File(
        [buffer],
        // The shared sanitizer is mandatory for anything reaching media
        // storage (REVIEW.md, 'Uploaded file names'): the drivers join this
        // name into a temp path, and path.join resolves '..'.
        sanitizeStoredFileName(attachment.filename ?? ''),
        {
          type: attachment.contentType
        }
      )
      const saved = await saveMedia(database, actor, { file })
      if (saved) mediaIds.push(saved.id)
    } catch (error) {
      logger.warn({
        message: 'Failed to store a reply-by-email attachment',
        actorId: actor.id,
        err: error
      })
    }
  }

  if (mediaIds.length === 0) return []
  return (await getAttachmentsFromMediaIds(database, actor, mediaIds)) ?? []
}

export const replyByEmailJob = createJobHandle(
  REPLY_BY_EMAIL_JOB_NAME,
  async (database, message) => {
    const parsed = ReplyByEmailJobData.safeParse(message.data)
    if (!parsed.success) return
    const data = parsed.data

    const { email, emailInbound } = getConfig()
    if (!email || !emailInbound) return

    const resolution = await resolveReplyToken(database, data.token)
    // An unknown hash names no actor, so there is genuinely nobody to answer.
    if (resolution.status === 'unknown') {
      logger.warn({ message: 'Reply by email: unknown token' })
      return
    }
    const token = resolution.token

    // Everything is re-checked here rather than trusted from mint time: the
    // actor may have been suspended, deleted or opted out since.
    const actor = await database.getActorFromId({ id: token.actorId })
    if (!actor?.privateKey) {
      logger.warn({
        message: 'Reply by email: actor is gone or not local',
        actorId: token.actorId
      })
      return
    }

    // The canonical moderation gate, shared with every authenticated API
    // surface: a suspended actor OR a disabled account. Reply by email is a
    // posting surface, so an admin who disables an account has to stop it here
    // too — otherwise the account keeps posting through addresses it was
    // issued before.
    if (isActorModerationBlocked(actor)) {
      logger.warn({
        message: 'Reply by email: actor is suspended or the account disabled',
        actorId: actor.id
      })
      return
    }

    // Duplicate deliveries are settled BEFORE a use is spent, so a provider
    // retrying one message cannot eat the token's budget.
    const idempotencyKey = idempotencyKeyFor(data)
    const alreadyPosted = await database.getIdempotentStatusId({
      actorId: actor.id,
      key: idempotencyKey
    })
    if (alreadyPosted) return

    // Spend the use here, before anything that can send mail or store media.
    //
    // Every failure below answers the sender with an email, and until this
    // moved up none of those paths spent a use — so one leaked address was an
    // unbounded stream of "we could not post your reply" mail into the account
    // owner's inbox, from the instance's own sending domain. Charging a use
    // first bounds the whole surface, notices included, to the token's
    // ceiling.
    //
    // The claim also re-tests the ceiling and expiry inside the UPDATE, so a
    // burst of concurrent deliveries cannot all pass one stale read.
    const claimed =
      resolution.status === 'ok' &&
      (await database.claimEmailReplyTokenUse({
        id: token.id,
        maxUses: REPLY_TOKEN_MAX_USES,
        now: Date.now()
      }))
    if (!claimed) {
      // Nothing is sent back: by the time a token is expired or spent its
      // owner has already had the notice, and answering every further message
      // is what made this an amplifier.
      logger.warn({
        message: `Reply by email: token ${resolution.status === 'ok' ? 'spent' : resolution.status}`,
        actorId: actor.id
      })
      return
    }

    const serverSettings = await getResolvedServerSettings(database)
    const actorSettings = await database.getActorSettings({ actorId: actor.id })
    if (!serverSettings.replyByEmail.enabled) {
      await notifyFailure(actor, 'disabled-instance')
      return
    }
    if (actorSettings?.replyByEmail !== true) {
      await notifyFailure(actor, 'disabled-account')
      return
    }

    // The token is the authorization; `From` is trivially forgeable without the
    // DKIM/SPF result that a normalized JSON webhook has already discarded.
    // Treating a mismatch as fatal would break replying from an alias, a
    // plus-address or a work account, so it is only recorded.
    const from = parseEmailAddress(data.from)
    const accountEmail = actor.account?.email
    if (
      from &&
      accountEmail &&
      normalizeEmail(from) !== normalizeEmail(accountEmail)
    ) {
      logger.warn({
        message: 'Reply by email: sender does not match the account email',
        actorId: actor.id,
        from
      })
    }

    const replyStatus = await database.getStatus({
      statusId: token.statusId,
      withReplies: false
    })
    if (!replyStatus) {
      await notifyFailure(actor, 'thread-missing')
      return
    }
    // An Announce carries no url of its own; unwrap to the boosted post so the
    // failure notice can still link somewhere useful.
    const statusUrl = getOriginalStatus(replyStatus).url

    const text = extractReplyText({ text: data.text, html: data.html })
    if (text.length === 0) {
      await notifyFailure(actor, 'empty', statusUrl)
      return
    }

    const limitError = validateStatusContentLimits(
      { status: text },
      serverSettings
    )
    if (limitError) {
      await notifyFailure(actor, 'too-long', statusUrl)
      return
    }

    const attachments = await storeAttachments(
      database,
      actor,
      data.attachments ?? [],
      data.html
    )

    // No `visibility`: createNoteFromUserInput inherits it from the parent, so
    // a reply to a DM stays direct and a reply to an unlisted post stays
    // unlisted, without the sender having to say so.
    const status = await createNoteFromUserInput({
      currentActor: actor,
      text,
      replyNoteId: token.statusId,
      attachments,
      database
    })

    if (!status) {
      await notifyFailure(actor, 'not-posted', statusUrl)
      return
    }

    await database.saveIdempotencyKey({
      actorId: actor.id,
      key: idempotencyKey,
      statusId: status.id
    })

    logger.info({
      message: 'Posted a reply from an inbound email',
      actorId: actor.id,
      statusId: status.id,
      replyToStatusId: token.statusId
    })
  }
)
