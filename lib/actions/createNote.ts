import {
  IdempotencyConflictError,
  IdempotencyDeletedError
} from '@/lib/database/domains/idempotency/types'
import { Database } from '@/lib/database/types'
import {
  PROCESS_FITNESS_FILE_JOB_NAME,
  SEND_NOTE_JOB_NAME,
  SEND_QUOTE_REQUEST_JOB_NAME
} from '@/lib/jobs/names'
import { buildMentionEmail } from '@/lib/services/email/templates/mention'
import { buildReplyEmail } from '@/lib/services/email/templates/reply'
import { getCommunityForNewReply } from '@/lib/services/federation/replyCommunity'
import { appendSubjectHashtags } from '@/lib/services/gallery/subjectHashtags'
import { persistDetectedLanguage } from '@/lib/services/language-detection'
import { syncStatusLinkPreview } from '@/lib/services/link-previews/syncStatusLinkPreview'
import {
  EMPTY_ATTACHMENT_MEDIA_METADATA,
  resolveOwnedAttachments
} from '@/lib/services/medias/attachmentMediaMetadata'
import { createNotificationWithPolicy } from '@/lib/services/notifications/createNotificationWithPolicy'
import { sendNotificationAlerts } from '@/lib/services/notifications/sendNotificationAlerts'
import { getQueue } from '@/lib/services/queue'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import {
  canActorReadStatus,
  isPublicOrUnlisted
} from '@/lib/services/statusAccess'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { Mention } from '@/lib/types/activitypub'
import { NotificationType } from '@/lib/types/database/operations'
import {
  Actor,
  getMention,
  getMentionFromActorID
} from '@/lib/types/domain/actor'
import { PostBoxAttachment } from '@/lib/types/domain/attachment'
import {
  QuoteApprovalPolicy,
  Status,
  StatusNote,
  getOriginalStatus
} from '@/lib/types/domain/status'
import { getLocalStatusId } from '@/lib/utils/activitypubId'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { MastodonVisibility } from '@/lib/utils/getVisibility'
import { logger } from '@/lib/utils/logger'
import { generatePublicId } from '@/lib/utils/publicId'
import { MENTION_GLOBAL_REGEX } from '@/lib/utils/text/convertMarkdownText'
import { getEmojiTags } from '@/lib/utils/text/getEmojiTags'
import { getHashtags } from '@/lib/utils/text/getHashtags'
import { getMentions } from '@/lib/utils/text/getMentions'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { withSpan } from '@/lib/utils/trace'

const inFlightStatusCreations = new Map<string, Promise<void>>()

export const waitForInFlightStatusCreation = async (
  statusId: string
): Promise<void> => {
  const inflight = inFlightStatusCreations.get(statusId)
  if (inflight) {
    await inflight
  }
}

export const trackInFlightStatusCreation = (statusId: string): (() => void) => {
  let resolve!: () => void
  const promise = new Promise<void>((res) => {
    resolve = res
  })
  inFlightStatusCreations.set(statusId, promise)
  return () => {
    resolve()
    inFlightStatusCreations.delete(statusId)
  }
}

// Waits out an in-process create of `statusId` and loads it. Null when that
// create failed and discarded its status and key, so a retry may create the
// post afresh; IdempotencyDeletedError when the key outlived its status.
export const loadIdempotentStatus = async ({
  database,
  actorId,
  key,
  statusId
}: {
  database: Database
  actorId: string
  key: string
  statusId: string
}): Promise<Status | null> => {
  await waitForInFlightStatusCreation(statusId)
  const status = await database.getStatus({ statusId, withReplies: false })
  if (status) return status
  const claim = await database.getIdempotencyKey({ actorId, key })
  if (claim?.statusId === statusId) throw new IdempotencyDeletedError(statusId)
  return null
}

export const resolveExistingIdempotentStatus = async ({
  database,
  actorId,
  idempotency
}: {
  database: Database
  actorId: string
  idempotency: { key: string; contentHash: string }
}): Promise<Status | null> => {
  const existingKey = await database.getIdempotencyKey({
    actorId,
    key: idempotency.key
  })
  if (!existingKey) return null
  if (
    existingKey.contentHash !== null &&
    existingKey.contentHash !== idempotency.contentHash
  ) {
    throw new IdempotencyConflictError()
  }
  return loadIdempotentStatus({
    database,
    actorId,
    key: idempotency.key,
    statusId: existingKey.statusId
  })
}

// One best-effort step of a status create: a failure is logged and the post
// still succeeds.
export const runBestEffortStep = async (
  statusId: string,
  step: string,
  work: () => Promise<unknown>
): Promise<void> => {
  try {
    await work()
  } catch (error) {
    logger.error({
      message: `Status create: ${step} failed`,
      statusId,
      err: toLoggableError(error)
    })
  }
}

// Undoes a create whose completion steps failed before it was federated, so a
// retry (with the same Idempotency-Key, if any) creates the post afresh.
export const discardFailedStatusCreate = async ({
  database,
  actorId,
  statusId,
  idempotency
}: {
  database: Database
  actorId: string
  statusId: string
  idempotency?: { key: string }
}): Promise<void> => {
  try {
    await database.discardUnpublishedStatus({
      actorId,
      statusId,
      idempotencyKey: idempotency?.key
    })
  } catch (error) {
    logger.error({
      message: 'Failed to discard a status whose create failed',
      statusId,
      err: toLoggableError(error)
    })
  }
}

const getNotificationEligibleActorIds = async (
  database: Database,
  recipientActorIds: string[],
  sourceActorId: string
) => {
  const candidateActorIds = [
    ...new Set(recipientActorIds.filter((actorId) => actorId !== sourceActorId))
  ]
  if (candidateActorIds.length === 0) return new Set<string>()

  const blockRelations = await database.getBlockRelations({
    actorIds: candidateActorIds,
    targetActorIds: [sourceActorId]
  })
  const blockedActorIds = new Set<string>()
  for (const relation of blockRelations) {
    if (relation.actorId === sourceActorId) {
      blockedActorIds.add(relation.targetActorId)
    } else if (relation.targetActorId === sourceActorId) {
      blockedActorIds.add(relation.actorId)
    }
  }

  const muteRelations = await database.getMuteRelations({
    actorIds: candidateActorIds,
    targetActorIds: [sourceActorId]
  })
  const mutedSourceActorIds = new Set(
    muteRelations
      .filter((relation) => relation.notifications)
      .map((relation) => relation.actorId)
  )

  return new Set(
    candidateActorIds.filter(
      (actorId) =>
        !blockedActorIds.has(actorId) && !mutedSourceActorIds.has(actorId)
    )
  )
}

export const getExplicitMentions = (
  text: string,
  mentions: Mention[]
): Mention[] => {
  const explicitMentionNames = new Set(
    Array.from(text.matchAll(MENTION_GLOBAL_REGEX)).map((match) =>
      match[0].trim()
    )
  )

  return mentions.filter((mention) =>
    explicitMentionNames.has(mention.name || '')
  )
}

const isActorRecipient = (recipient: string) =>
  recipient !== ACTIVITY_STREAM_PUBLIC &&
  recipient !== ACTIVITY_STREAM_PUBLIC_COMPACT &&
  !recipient.endsWith('/followers')

export const getMentionTagsForStatus = ({
  mentions,
  currentActor,
  replyStatus,
  effectiveVisibility,
  replyVisibility
}: {
  mentions: Mention[]
  currentActor: Actor
  replyStatus: Status | null
  effectiveVisibility: MastodonVisibility
  replyVisibility: MastodonVisibility | null
}): Mention[] => {
  if (
    effectiveVisibility !== 'direct' ||
    !replyStatus ||
    replyVisibility !== 'direct'
  ) {
    return mentions
  }

  const mentionsByHref = new Map(
    mentions.map((mention) => [mention.href, mention])
  )
  const inheritedActorIds = [
    replyStatus.actorId,
    ...replyStatus.to,
    ...replyStatus.cc
  ]

  for (const actorId of inheritedActorIds) {
    if (
      actorId === currentActor.id ||
      !isActorRecipient(actorId) ||
      mentionsByHref.has(actorId)
    ) {
      continue
    }

    mentionsByHref.set(actorId, {
      type: 'Mention',
      href: actorId,
      name: getMentionFromActorID(actorId, true)
    })
  }

  return [...mentionsByHref.values()]
}

/**
 * Scans status text for `:shortcode:` tokens, resolves them against the
 * instance's enabled custom-emoji set, and persists matching `emoji` domain
 * Tags for the status. These tags drive local rendering
 * (`convertEmojisToImages`) and federate as ActivityPub `Emoji` tags
 * (`getEmojiFromTag`). Disabled emoji are ignored; `visible_in_picker` is not
 * considered so a hand-typed non-picker emoji still federates (matching
 * Mastodon). Returns the number of emoji tags persisted.
 */
export const persistEmojiTagsForStatus = async ({
  database,
  statusId,
  text
}: {
  database: Database
  statusId: string
  text: string | string[]
}): Promise<number> => {
  const combinedText = Array.isArray(text) ? text.join(' ') : text
  const customEmojis = await database.getCustomEmojis()
  const emojiTags = getEmojiTags(combinedText, customEmojis)
  await Promise.all(
    emojiTags.map((emojiTag) =>
      database.createTag({
        statusId,
        name: emojiTag.name,
        value: emojiTag.value,
        type: 'emoji'
      })
    )
  )
  return emojiTags.length
}

/**
 * Determines the 'to' recipients based on visibility and reply context.
 *
 * Visibility rules for 'to':
 * - public: [Public]
 * - unlisted: [followersUrl]
 * - private: [followersUrl]
 * - direct: [specific recipients from mentions], plus existing direct-thread recipients on direct replies
 *
 * When replying, inherits visibility from the parent status if not specified.
 */
export const statusRecipientsTo = (
  actor: Actor,
  mentions: Mention[],
  replyStatus: Status | null,
  visibility: MastodonVisibility = 'public',
  replyVisibility: MastodonVisibility | null = getVisibilityFromReplyStatus(
    replyStatus
  )
): string[] => {
  // Direct replies only inherit parent recipients when the parent is already
  // direct; otherwise explicit direct recipients stay isolated from public or
  // followers audiences on the parent.
  if (visibility === 'direct') {
    const recipients = mentions.map((item) => item.href)
    if (replyStatus && replyVisibility === 'direct') {
      recipients.push(...replyStatus.to)
      // If replying to a direct thread, also include the original author even
      // when they were only in cc.
      recipients.push(replyStatus.actorId)
    }
    return [...new Set(recipients)] // Remove duplicates
  }

  // For public visibility
  if (visibility === 'public') {
    if (replyStatus) {
      return [ACTIVITY_STREAM_PUBLIC, actor.followersUrl]
    }
    return [ACTIVITY_STREAM_PUBLIC]
  }

  // For unlisted and private, use followers URL
  // (unlisted = followers in 'to', public in 'cc')
  // (private = followers in 'to', nothing public)
  // When replying, also include the original author so they receive the reply
  if (replyStatus) {
    return [...new Set([actor.followersUrl, replyStatus.actorId])]
  }
  return [actor.followersUrl]
}

/**
 * Determines the 'cc' recipients based on visibility and reply context.
 *
 * Visibility rules for 'cc':
 * - public: [followersUrl, ...mentions]
 * - unlisted: [Public, ...mentions]
 * - private: [...mentions only]
 * - direct: parent cc for direct-thread replies, otherwise [] (no cc for new direct messages)
 */
export const statusRecipientsCC = (
  actor: Actor,
  mentions: Mention[],
  replyStatus: Status | null,
  visibility: MastodonVisibility = 'public',
  replyVisibility: MastodonVisibility | null = getVisibilityFromReplyStatus(
    replyStatus
  ),
  communityActorId: string | null = null
): string[] => {
  const mentionHrefs = mentions.map((item) => item.href)
  // A reply in a community (FEP-1b12) is also addressed to the community actor
  // so its inbox gets it and the group can redistribute it. Never for
  // followers-only or direct replies: those must not reach a public group.
  const communityHrefs =
    communityActorId && (visibility === 'public' || visibility === 'unlisted')
      ? [communityActorId]
      : []

  if (visibility === 'direct') {
    return replyStatus && replyVisibility === 'direct'
      ? [...new Set(replyStatus.cc)]
      : []
  }

  // For private (followers only), only include mentions
  if (visibility === 'private') {
    return mentionHrefs
  }

  // For unlisted, put Public in cc instead of to
  if (visibility === 'unlisted') {
    return [
      ...new Set([ACTIVITY_STREAM_PUBLIC, ...communityHrefs, ...mentionHrefs])
    ]
  }

  // For public, followers in cc along with mentions
  return [...new Set([actor.followersUrl, ...communityHrefs, ...mentionHrefs])]
}

/**
 * Derives visibility from a reply status for consistent threading.
 * If the parent is more restrictive, the reply should match.
 */
export const getVisibilityFromReplyStatus = (
  replyStatus: Status | null
): MastodonVisibility | null => {
  if (!replyStatus) return null

  // Check if parent is public
  if (
    replyStatus.to.includes(ACTIVITY_STREAM_PUBLIC) ||
    replyStatus.to.includes(ACTIVITY_STREAM_PUBLIC_COMPACT)
  ) {
    return 'public'
  }

  // Check if parent is unlisted (Public in cc)
  if (
    replyStatus.cc.includes(ACTIVITY_STREAM_PUBLIC) ||
    replyStatus.cc.includes(ACTIVITY_STREAM_PUBLIC_COMPACT)
  ) {
    return 'unlisted'
  }

  // Check if parent has followers (private)
  const hasFollowers = [...replyStatus.to, ...replyStatus.cc].some((item) =>
    item.endsWith('/followers')
  )
  if (hasFollowers) {
    return 'private'
  }

  // Otherwise direct
  return 'direct'
}

interface CreateNoteFromUserInputParams {
  text: string
  summary?: string | null
  replyNoteId?: string
  // The status id (URL) this note quotes, already resolved and authorized by the
  // caller (the route enforces visibility + canQuoteStatus). Omitted for
  // non-quoting posts.
  quotedStatusId?: string
  // Who may quote THIS status (persisted in the content blob).
  quoteApprovalPolicy?: QuoteApprovalPolicy
  currentActor: Actor
  attachments?: PostBoxAttachment[]
  fitnessFileId?: string
  visibility?: MastodonVisibility
  sensitive?: boolean
  language?: string | null
  // The registered OAuth client (Mastodon "application") that authored the
  // status, when created via an app token. Omitted for web-session creates.
  application?: { name: string; website: string | null }
  // Backdate the status (ms since epoch); omitted means now. The publicId is
  // minted from this time so id order keeps matching createdAt order.
  createdAt?: number
  idempotency?: { key: string; contentHash: string }
  database: Database
}
export const createNoteFromUserInput = async ({
  text,
  summary,
  replyNoteId,
  quotedStatusId,
  quoteApprovalPolicy,
  currentActor,
  attachments = [],
  fitnessFileId,
  visibility,
  sensitive = false,
  language = null,
  application,
  createdAt,
  idempotency,
  database
}: CreateNoteFromUserInputParams) =>
  withSpan('actions', 'createNoteFromUser', { text, replyNoteId }, async () => {
    if (idempotency) {
      const existing = await resolveExistingIdempotentStatus({
        database,
        actorId: currentActor.id,
        idempotency
      })
      if (existing) return existing as StatusNote
    }
    // Subject hashtags are part of the post: appended here, before the text is
    // stored and before its hashtags are extracted below, so they are rendered,
    // federated and counted like tags the author typed.
    const subjectMediaIds = attachments
      .map((attachment) => attachment.id)
      .filter((id): id is string => Boolean(id))
    // The request was validated against `posts.maxCharacters` before this
    // runs, so appended tags are held to the same limit (or the stored post
    // could no longer be edited).
    const maxCharacters =
      subjectMediaIds.length > 0
        ? (await getResolvedServerSettings(database)).posts.maxCharacters
        : undefined
    text = await appendSubjectHashtags({
      database,
      accountId: currentActor.account?.id,
      actorId: currentActor.id,
      text,
      mediaIds: subjectMediaIds,
      maxCharacters
    })

    const fitnessFile = fitnessFileId
      ? await database.getFitnessFile({ id: fitnessFileId })
      : null

    if (
      fitnessFileId &&
      (!fitnessFile ||
        fitnessFile.actorId !== currentActor.id ||
        Boolean(fitnessFile.statusId))
    ) {
      return null
    }

    const replyStatus = replyNoteId
      ? await database.getStatus({ statusId: replyNoteId, withReplies: false })
      : null
    // A reply inherits its parent's audience (a direct reply copies the
    // parent's recipients), so the author must be able to read the parent.
    // Request routes check this up front; this covers every other caller,
    // including a scheduled reply published long after it was authorized.
    if (
      replyStatus &&
      !(await canActorReadStatus({
        database,
        status: replyStatus,
        currentActor
      }))
    ) {
      return null
    }

    const postId = generatePublicId(createdAt)
    const statusId = getLocalStatusId({
      actorId: currentActor.id,
      statusId: postId
    })
    const mentions = await getMentions({ text, currentActor, replyStatus })
    const explicitMentions = getExplicitMentions(text, mentions)

    // Determine effective visibility:
    // 1. Use provided visibility if specified
    // 2. Otherwise inherit from reply status if replying
    // 3. Default to 'public'
    const replyVisibility = getVisibilityFromReplyStatus(replyStatus)
    const effectiveVisibility = visibility ?? replyVisibility ?? 'public'
    const isReplyingToDirectThread = replyStatus && replyVisibility === 'direct'
    if (
      effectiveVisibility === 'direct' &&
      explicitMentions.length === 0 &&
      !isReplyingToDirectThread
    ) {
      return null
    }
    const recipientMentions =
      effectiveVisibility === 'direct' &&
      replyStatus &&
      replyVisibility !== 'direct'
        ? explicitMentions
        : mentions
    const shouldNotifyReply =
      Boolean(replyStatus) &&
      !(
        effectiveVisibility === 'direct' &&
        replyStatus &&
        replyVisibility !== 'direct'
      )

    // Replies to a community's post stay in that community (public and
    // unlisted only; see statusRecipientsCC).
    const communityActorId = await getCommunityForNewReply({
      database,
      replyStatus,
      visibility: effectiveVisibility
    })

    const to = statusRecipientsTo(
      currentActor,
      recipientMentions,
      replyStatus,
      effectiveVisibility,
      replyVisibility
    )
    const cc = statusRecipientsCC(
      currentActor,
      recipientMentions,
      replyStatus,
      effectiveVisibility,
      replyVisibility,
      communityActorId
    )
    const mentionTags = getMentionTagsForStatus({
      mentions,
      currentActor,
      replyStatus,
      effectiveVisibility,
      replyVisibility
    })

    const finishInFlight = trackInFlightStatusCreation(statusId)
    let createdStatus: Status
    let isNew = true
    try {
      const createParams = {
        id: statusId,
        url: `https://${currentActor.domain}/${getMention(currentActor)}/${postId}`,
        publicId: postId,

        actorId: currentActor.id,

        text,
        summary: summary?.trim() || null,

        to,
        cc,

        reply: replyStatus?.id || '',
        // A sensitized actor's new statuses are forced sensitive at creation, so
        // the flag is persisted and federated copies inherit it (Admin moderation).
        sensitive: sensitive || Boolean(currentActor.sensitizedAt),
        language,
        quoteApprovalPolicy,
        applicationName: application?.name ?? null,
        applicationWebsite: application?.website ?? null,
        createdAt,
        ...(idempotency ? { idempotency } : {})
      }
      if (idempotency) {
        const result = await database.createNoteWithResult(createParams)
        createdStatus = result.status
        isNew = result.isNew
      } else {
        createdStatus = await database.createNote(createParams)
      }
    } catch (error) {
      finishInFlight()
      throw error
    }

    if (!isNew && idempotency) {
      finishInFlight()
      const existing = await loadIdempotentStatus({
        database,
        actorId: currentActor.id,
        key: idempotency.key,
        statusId: createdStatus.id
      })
      // The winner's create failed and was discarded; the client retries.
      if (!existing) {
        throw new Error('Concurrent create with this Idempotency-Key failed')
      }
      return existing as StatusNote
    }

    // Completion steps: without any of them the post is incomplete, so a
    // failure discards it (it is not federated yet; the publish is last) and
    // fails the request. Best-effort steps log their failure and carry on.
    let status: StatusNote
    let remoteQuoteRequest = false
    let localQuotedAuthorId: string | null = null
    const hashtags = getHashtags(text, currentActor.domain)
    try {
      // Quote handling (FEP-044f). The caller has already authorized the quote
      // (visibility + canQuoteStatus), so record the edge here and drive the
      // handshake after the publish. Doing this before the final status
      // re-fetch means the returned status (and the federated note) already
      // carry the quote edge.
      if (quotedStatusId) {
        const quotedStatus = await database.getStatus({
          statusId: quotedStatusId,
          withReplies: false
        })
        if (quotedStatus) {
          const quotedAuthorId = getOriginalStatus(quotedStatus).actorId
          if (quotedStatus.isLocalActor) {
            // We host the quoted author (FEP same-authority shortcut): approve
            // immediately, no QuoteRequest handshake.
            await database.createStatusQuote({
              statusId,
              quotedStatusId,
              state: 'accepted'
            })
            if (quotedAuthorId !== currentActor.id) {
              localQuotedAuthorId = quotedAuthorId
            }
          } else {
            // Remote quoted author: create a pending edge; the QuoteRequest
            // handshake below lets their Accept/Reject settle it.
            await database.createStatusQuote({
              statusId,
              quotedStatusId,
              state: 'pending',
              quoteRequestId: `${statusId}#quote-request`
            })
            remoteQuoteRequest = true
          }
        }
      }

      // Content-detected language, stored separately from the declared `language`
      // above so the Translate gate can fall back to it when the author's
      // declared/default language doesn't match what they actually wrote.
      await runBestEffortStep(statusId, 'detected language', () =>
        persistDetectedLanguage({
          database,
          statusId,
          text,
          declaredLanguage: language
        })
      )

      // Tags must be persisted before timeline rules run so that
      // notifyRemoteReplyAndMention can verify mentions via tags rather than text
      // content.
      await Promise.all([
        ...mentionTags.map((mention) =>
          database.createTag({
            statusId,
            name: mention.name || '',
            value: mention.href,
            type: 'mention'
          })
        ),
        ...hashtags.map((hashtag) =>
          database.createTag({
            statusId,
            name: hashtag.name,
            value: hashtag.value,
            type: 'hashtag',
            skipSearchIndex: true
          })
        )
      ])
      await runBestEffortStep(
        statusId,
        'hashtag counters and search',
        async () => {
          // The count is served to anonymous /tags/<tag> visitors; a
          // followers-only or direct post must not move it.
          if (isPublicOrUnlisted({ to, cc })) {
            await Promise.all(
              hashtags.map((hashtag) =>
                database.increaseHashtagCounter({ hashtag: hashtag.name })
              )
            )
          }
          if (hashtags.length > 0) {
            await database.indexHashtagSearchDocuments({
              hashtags: hashtags.map((hashtag) => hashtag.name)
            })
          }
        }
      )

      // Before the publish: the federated note carries its emoji tags.
      await runBestEffortStep(statusId, 'emoji tags', () =>
        persistEmojiTagsForStatus({
          database,
          statusId,
          text: [text, summary ?? '', ...attachments.map((a) => a.name || '')]
        })
      )

      // The file, placeholder and focal point are read back from the owner's own
      // media rows: a stale composer or an outbox client can send an earlier
      // render of an edited photo, which a later save may prune.
      const ownedAttachments = await resolveOwnedAttachments({
        database,
        currentActor,
        attachments
      })

      // A backdated status's attachments are backdated with it.
      const attachmentsCreatedAt = createdAt ?? Date.now()
      await Promise.all([
        addStatusToTimelines(database, createdStatus),
        ...ownedAttachments.map(({ attachment, metadata }, index) => {
          // Link the attachment to a media row only when that row belongs to
          // the author's account. The outbox takes attachment ids from the
          // client, and `attachments.mediaId` is read as proof the media's owner
          // published it (the public details endpoint relies on it), so an id
          // that did not resolve to an owned row is written without a link.
          const ownedMetadata = metadata ?? undefined
          return database.createAttachment({
            // The inserts run in parallel, so without a distinct, increasing
            // createdAt every attachment of the status would share one
            // timestamp and reads (createdAt, then random id) would shuffle
            // them. base + index ms preserves the author's order.
            createdAt: attachmentsCreatedAt + index,
            actorId: currentActor.id,
            statusId,
            mediaType: attachment.mediaType,
            url: attachment.url,
            width: attachment.width,
            height: attachment.height,
            name: attachment.name,
            ...(ownedMetadata ? { mediaId: String(attachment.id) } : {}),
            ...(ownedMetadata ?? EMPTY_ATTACHMENT_MEDIA_METADATA)
          })
        })
      ])

      if (fitnessFile) {
        await database.updateFitnessFileStatus(fitnessFile.id, statusId)
      }

      const hydratedStatus = (await database.getStatus({
        statusId,
        withReplies: false
      })) as StatusNote | null
      if (!hydratedStatus) {
        return null
      }
      status = hydratedStatus

      // The last completion step: once the job is queued the post is on its
      // way out and is never discarded.
      const queue = getQueue()
      try {
        await queue.publish(
          fitnessFile
            ? {
                id: getHashFromString(status.id),
                name: PROCESS_FITNESS_FILE_JOB_NAME,
                data: {
                  actorId: currentActor.id,
                  statusId: status.id,
                  fitnessFileId: fitnessFile.id
                }
              }
            : {
                id: getHashFromString(status.id),
                name: SEND_NOTE_JOB_NAME,
                data: { actorId: currentActor.id, statusId: status.id }
              }
        )
      } catch (error) {
        // An inline queue ran the job inside `publish`, so the note may
        // already have reached some inboxes: keep the post, do not discard it.
        if (!queue.runsInline) throw error
        logger.error({
          message: 'Federation job failed inline after status creation',
          statusId,
          err: toLoggableError(error)
        })
      }
    } catch (error) {
      await discardFailedStatusCreate({
        database,
        actorId: currentActor.id,
        statusId,
        idempotency
      })
      throw error
    } finally {
      finishInFlight()
    }

    // Best-effort steps after the publish, so nobody is notified of a post
    // that was then discarded.
    if (remoteQuoteRequest && quotedStatusId) {
      const quoteRequestId = `${statusId}#quote-request`
      await runBestEffortStep(statusId, 'quote request enqueue', () =>
        getQueue().publish({
          id: getHashFromString(quoteRequestId),
          name: SEND_QUOTE_REQUEST_JOB_NAME,
          data: { actorId: currentActor.id, statusId, quotedStatusId }
        })
      )
    }

    await runBestEffortStep(statusId, 'notifications', () =>
      notifyStatusRecipients({
        database,
        currentActor,
        status,
        quotedStatusId,
        localQuotedAuthorId,
        replyStatus,
        shouldNotifyReply,
        notificationMentions:
          effectiveVisibility === 'direct' &&
          replyStatus &&
          replyVisibility === 'direct'
            ? mentionTags
            : recipientMentions
      })
    )

    // Scheduled AFTER the send/process job is published, because on the default
    // in-process queue `publish` runs the handler inline — so doing this first
    // made a link post wait on a third-party fetch before it federated. It never
    // throws (see syncStatusLinkPreview).
    await syncStatusLinkPreview({ database, status })

    return status
  })

// Creates the quote, reply and mention notifications of a new status and
// dispatches their push/email alerts (fire-and-forget).
const notifyStatusRecipients = async ({
  database,
  currentActor,
  status,
  quotedStatusId,
  localQuotedAuthorId,
  replyStatus,
  shouldNotifyReply,
  notificationMentions
}: {
  database: Database
  currentActor: Actor
  status: StatusNote
  quotedStatusId?: string
  localQuotedAuthorId: string | null
  replyStatus: Status | null
  shouldNotifyReply: boolean
  notificationMentions: Mention[]
}) => {
  const statusId = status.id
  if (localQuotedAuthorId && quotedStatusId) {
    const quoteNotification = await createNotificationWithPolicy(database, {
      actorId: localQuotedAuthorId,
      type: NotificationType.enum.quote,
      sourceActorId: currentActor.id,
      statusId,
      groupKey: `quote:${quotedStatusId}`
    })
    if (quoteNotification && !quoteNotification.filtered) {
      // Fire-and-forget (sendNotificationAlerts handles its own errors):
      // alert delivery must not fail the create action.
      sendNotificationAlerts({
        database,
        actorId: localQuotedAuthorId,
        sourceActorId: currentActor.id,
        sourceActor: currentActor,
        statusId,
        events: [
          {
            type: NotificationType.enum.quote,
            notificationId: quoteNotification.id
          }
        ]
      })
    }
  }

  const eligibleNotificationActorIds = await getNotificationEligibleActorIds(
    database,
    [
      ...(shouldNotifyReply && replyStatus ? [replyStatus.actorId] : []),
      ...notificationMentions.map((mention) => mention.href)
    ],
    currentActor.id
  )

  // Map actorId → notification promise so we can gate alert dispatch on the verdict.
  const notificationEntries: Array<
    [string, ReturnType<typeof createNotificationWithPolicy>]
  > = []

  // Create reply notification if this is a reply
  const replyNotifiedActorId =
    shouldNotifyReply &&
    replyStatus &&
    eligibleNotificationActorIds.has(replyStatus.actorId)
      ? replyStatus.actorId
      : null
  if (replyNotifiedActorId && replyStatus) {
    notificationEntries.push([
      replyNotifiedActorId,
      createNotificationWithPolicy(database, {
        actorId: replyNotifiedActorId,
        type: NotificationType.enum.reply,
        sourceActorId: currentActor.id,
        statusId,
        groupKey: `reply:${replyStatus.id}`
      })
    ])
  }

  // Create mention notifications
  for (const mention of notificationMentions) {
    const mentionedActorId = mention.href
    // A reply that also mentions the parent author is a single event: the reply
    // notification above already covers them, so skip the duplicate mention one.
    if (mentionedActorId === replyNotifiedActorId) {
      continue
    }
    // Don't create notification for self-mentions
    if (eligibleNotificationActorIds.has(mentionedActorId)) {
      notificationEntries.push([
        mentionedActorId,
        createNotificationWithPolicy(database, {
          actorId: mentionedActorId,
          type: NotificationType.enum.mention,
          sourceActorId: currentActor.id,
          statusId,
          groupKey: `mention:${statusId}`
        })
      ])
    }
  }

  // Only send push/email alerts for notifications that were accepted (non-null, filtered=false).
  const notificationResults = await Promise.all(
    notificationEntries.map(([, p]) => p)
  )
  const alertActorIds = new Set(
    notificationEntries
      .filter((_, i) => {
        const n = notificationResults[i]
        return n && !n.filtered
      })
      .map(([actorId]) => actorId)
  )
  // Map each alerted actor to its accepted notification id so the Mastodon Web
  // Push payload can carry `notification_id`. Each actor has at most one
  // accepted notification here (reply and mention to the same actor are deduped
  // above), so a last-write-wins map is sufficient.
  const notificationIdByActorId = new Map<string, string>()
  notificationEntries.forEach(([actorId], i) => {
    const n = notificationResults[i]
    if (n && !n.filtered) {
      notificationIdByActorId.set(actorId, n.id)
    }
  })

  // Dispatch notification alerts (push + email) per target, fire-and-forget.
  // Uses the fetched status (with actor info) to build email content.
  const seenActorIds = new Set<string>()

  if (
    shouldNotifyReply &&
    replyStatus &&
    alertActorIds.has(replyStatus.actorId)
  ) {
    seenActorIds.add(replyStatus.actorId)
    database
      .getActorFromId({ id: replyStatus.actorId })
      // A failed actor lookup only skips the email content; the push alert
      // must still be dispatched.
      .catch(() => null)
      .then((targetActor) =>
        sendNotificationAlerts({
          database,
          actorId: replyStatus.actorId,
          sourceActorId: currentActor.id,
          sourceActor: currentActor,
          statusId,
          events: [
            {
              type: NotificationType.enum.reply,
              notificationId: notificationIdByActorId.get(replyStatus.actorId),
              emailContent: targetActor?.account
                ? {
                    recipientEmail: targetActor.account.email,
                    ...buildReplyEmail({
                      recipient: targetActor,
                      actor: currentActor,
                      status
                    })
                  }
                : undefined
            }
          ]
        })
      )
      .catch(() => undefined)
  }

  for (const mention of notificationMentions) {
    const mentionedActorId = mention.href
    if (
      !seenActorIds.has(mentionedActorId) &&
      alertActorIds.has(mentionedActorId)
    ) {
      seenActorIds.add(mentionedActorId)
      database
        .getActorFromId({ id: mentionedActorId })
        // A failed actor lookup only skips the email content; the push alert
        // must still be dispatched.
        .catch(() => null)
        .then((targetActor) =>
          sendNotificationAlerts({
            database,
            actorId: mentionedActorId,
            sourceActorId: currentActor.id,
            sourceActor: currentActor,
            statusId,
            events: [
              {
                type: NotificationType.enum.mention,
                notificationId: notificationIdByActorId.get(mentionedActorId),
                emailContent: targetActor?.account
                  ? {
                      recipientEmail: targetActor.account.email,
                      ...buildMentionEmail({
                        recipient: targetActor,
                        actor: currentActor,
                        status
                      })
                    }
                  : undefined
              }
            ]
          })
        )
        .catch(() => undefined)
    }
  }
}
