import crypto from 'crypto'

import { Database } from '@/lib/database/types'
import {
  PROCESS_FITNESS_FILE_JOB_NAME,
  SEND_NOTE_JOB_NAME
} from '@/lib/jobs/names'
import {
  getHTMLContent as getMentionHTMLContent,
  getSubject as getMentionSubject,
  getTextContent as getMentionTextContent
} from '@/lib/services/email/templates/mention'
import {
  getHTMLContent as getReplyHTMLContent,
  getSubject as getReplySubject,
  getTextContent as getReplyTextContent
} from '@/lib/services/email/templates/reply'
import { persistDetectedLanguage } from '@/lib/services/language-detection'
import { createNotificationWithPolicy } from '@/lib/services/notifications/createNotificationWithPolicy'
import { sendNotificationAlerts } from '@/lib/services/notifications/sendNotificationAlerts'
import { getQueue } from '@/lib/services/queue'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { Mention } from '@/lib/types/activitypub'
import { NotificationType } from '@/lib/types/database/operations'
import {
  Actor,
  getMention,
  getMentionFromActorID
} from '@/lib/types/domain/actor'
import { PostBoxAttachment } from '@/lib/types/domain/attachment'
import { Status, StatusNote } from '@/lib/types/domain/status'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { MastodonVisibility } from '@/lib/utils/getVisibility'
import { MENTION_GLOBAL_REGEX } from '@/lib/utils/text/convertMarkdownText'
import { getEmojiTags } from '@/lib/utils/text/getEmojiTags'
import { getHashtags } from '@/lib/utils/text/getHashtags'
import { getMentions } from '@/lib/utils/text/getMentions'
import { getSpan } from '@/lib/utils/trace'

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
  text: string
}): Promise<number> => {
  const customEmojis = await database.getCustomEmojis()
  const emojiTags = getEmojiTags(text, customEmojis)
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
  )
): string[] => {
  const mentionHrefs = mentions.map((item) => item.href)

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
    return [ACTIVITY_STREAM_PUBLIC, ...mentionHrefs]
  }

  // For public, followers in cc along with mentions
  return [actor.followersUrl, ...mentionHrefs]
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
  currentActor: Actor
  attachments?: PostBoxAttachment[]
  fitnessFileId?: string
  visibility?: MastodonVisibility
  sensitive?: boolean
  language?: string | null
  // The registered OAuth client (Mastodon "application") that authored the
  // status, when created via an app token. Omitted for web-session creates.
  application?: { name: string; website: string | null }
  database: Database
}
export const createNoteFromUserInput = async ({
  text,
  summary,
  replyNoteId,
  currentActor,
  attachments = [],
  fitnessFileId,
  visibility,
  sensitive = false,
  language = null,
  application,
  database
}: CreateNoteFromUserInputParams) => {
  const span = getSpan('actions', 'createNoteFromUser', { text, replyNoteId })
  const fitnessFile = fitnessFileId
    ? await database.getFitnessFile({ id: fitnessFileId })
    : null

  if (
    fitnessFileId &&
    (!fitnessFile ||
      fitnessFile.actorId !== currentActor.id ||
      Boolean(fitnessFile.statusId))
  ) {
    span.end()
    return null
  }

  const replyStatus = replyNoteId
    ? await database.getStatus({ statusId: replyNoteId, withReplies: false })
    : null

  const postId = crypto.randomUUID()
  const statusId = `${currentActor.id}/statuses/${postId}`
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
    span.end()
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
    replyVisibility
  )
  const mentionTags = getMentionTagsForStatus({
    mentions,
    currentActor,
    replyStatus,
    effectiveVisibility,
    replyVisibility
  })

  const createdStatus = await database.createNote({
    id: statusId,
    url: `https://${currentActor.domain}/${getMention(currentActor)}/${postId}`,

    actorId: currentActor.id,

    text,
    summary: summary?.trim() || null,

    to,
    cc,

    reply: replyStatus?.id || '',
    sensitive,
    language,
    applicationName: application?.name ?? null,
    applicationWebsite: application?.website ?? null
  })

  // Content-detected language, stored separately from the declared `language`
  // above so the Translate gate can fall back to it when the author's
  // declared/default language doesn't match what they actually wrote.
  await persistDetectedLanguage({ database, statusId, text })

  // Tags must be persisted before timeline rules run so that
  // notifyRemoteReplyAndMention can verify mentions via tags rather than text
  // content.
  const hashtags = getHashtags(text, currentActor.domain)
  await Promise.all([
    ...mentionTags.map((mention) =>
      database.createTag({
        statusId,
        name: mention.name || '',
        value: mention.href,
        type: 'mention'
      })
    ),
    ...hashtags.map(async (hashtag) => {
      await database.createTag({
        statusId,
        name: hashtag.name,
        value: hashtag.value,
        type: 'hashtag',
        skipSearchIndex: true
      })
      await database.increaseHashtagCounter({ hashtag: hashtag.name })
    })
  ])
  if (hashtags.length > 0) {
    await database.indexHashtagSearchDocuments({
      hashtags: hashtags.map((hashtag) => hashtag.name)
    })
  }

  await persistEmojiTagsForStatus({ database, statusId, text })

  await Promise.all([
    addStatusToTimelines(database, createdStatus),
    ...attachments.map((attachment) =>
      database.createAttachment({
        actorId: currentActor.id,
        statusId,
        mediaType: attachment.mediaType,
        url: attachment.url,
        width: attachment.width,
        height: attachment.height,
        name: attachment.name,
        mediaId: attachment.id
      })
    )
  ])

  if (fitnessFile) {
    await database.updateFitnessFileStatus(fitnessFile.id, statusId)
  }

  // Create notifications for replies and mentions
  const notificationMentions =
    effectiveVisibility === 'direct' &&
    replyStatus &&
    replyVisibility === 'direct'
      ? mentionTags
      : recipientMentions
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

  const status = (await database.getStatus({
    statusId,
    withReplies: false
  })) as StatusNote
  if (!status) {
    span.end()
    return null
  }

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
                    subject: getReplySubject(currentActor),
                    text: getReplyTextContent(status),
                    html: getReplyHTMLContent(status)
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
                      subject: getMentionSubject(currentActor),
                      text: getMentionTextContent(status),
                      html: getMentionHTMLContent(status)
                    }
                  : undefined
              }
            ]
          })
        )
        .catch(() => undefined)
    }
  }

  if (fitnessFile) {
    await getQueue().publish({
      id: getHashFromString(status.id),
      name: PROCESS_FITNESS_FILE_JOB_NAME,
      data: {
        actorId: currentActor.id,
        statusId: status.id,
        fitnessFileId: fitnessFile.id
      }
    })
  } else {
    await getQueue().publish({
      id: getHashFromString(status.id),
      name: SEND_NOTE_JOB_NAME,
      data: {
        actorId: currentActor.id,
        statusId: status.id
      }
    })
  }

  span.end()
  return status
}
