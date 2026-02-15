import crypto from 'crypto'

import { Database } from '@/lib/database/types'
import {
  PROCESS_FITNESS_FILE_JOB_NAME,
  SEND_NOTE_JOB_NAME
} from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { Mention } from '@/lib/types/activitypub'
import { NotificationType } from '@/lib/types/database/operations'
import { Actor, getMention } from '@/lib/types/domain/actor'
import { PostBoxAttachment } from '@/lib/types/domain/attachment'
import { Status, StatusNote } from '@/lib/types/domain/status'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { MastodonVisibility } from '@/lib/utils/getVisibility'
import { getMentions } from '@/lib/utils/text/getMentions'
import { getSpan } from '@/lib/utils/trace'

/**
 * Determines the 'to' recipients based on visibility and reply context.
 *
 * Visibility rules for 'to':
 * - public: [Public]
 * - unlisted: [followersUrl]
 * - private: [followersUrl]
 * - direct: [specific recipients from mentions]
 *
 * When replying, inherits visibility from the parent status if not specified.
 */
export const statusRecipientsTo = (
  actor: Actor,
  mentions: Mention[],
  replyStatus: Status | null,
  visibility: MastodonVisibility = 'public'
): string[] => {
  // For direct messages, only send to mentioned users
  if (visibility === 'direct') {
    const recipients = mentions.map((item) => item.href)
    // If replying, also include the original author
    if (replyStatus) {
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
 * - direct: [] (no cc for direct messages)
 */
export const statusRecipientsCC = (
  actor: Actor,
  mentions: Mention[],
  replyStatus: Status | null,
  visibility: MastodonVisibility = 'public'
): string[] => {
  const mentionHrefs = mentions.map((item) => item.href)

  // For direct messages, no cc recipients
  if (visibility === 'direct') {
    return []
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
  replyNoteId?: string
  currentActor: Actor
  attachments?: PostBoxAttachment[]
  fitnessFileId?: string
  visibility?: MastodonVisibility
  database: Database
}
export const createNoteFromUserInput = async ({
  text,
  replyNoteId,
  currentActor,
  attachments = [],
  fitnessFileId,
  visibility,
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

  // Determine effective visibility:
  // 1. Use provided visibility if specified
  // 2. Otherwise inherit from reply status if replying
  // 3. Default to 'public'
  const replyVisibility = getVisibilityFromReplyStatus(replyStatus)
  const effectiveVisibility = visibility ?? replyVisibility ?? 'public'

  const to = statusRecipientsTo(
    currentActor,
    mentions,
    replyStatus,
    effectiveVisibility
  )
  const cc = statusRecipientsCC(
    currentActor,
    mentions,
    replyStatus,
    effectiveVisibility
  )

  const createdStatus = await database.createNote({
    id: statusId,
    url: `https://${currentActor.domain}/${getMention(currentActor)}/${postId}`,

    actorId: currentActor.id,

    text,
    summary: null,

    to,
    cc,

    reply: replyStatus?.id || ''
  })

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
    ),
    ...mentions.map((mention) =>
      database.createTag({
        statusId,
        name: mention.name || '',
        value: mention.href,
        type: 'mention'
      })
    )
  ])

  if (fitnessFile) {
    await database.updateFitnessFileStatus(fitnessFile.id, statusId)
  }

  // Create notifications for replies and mentions
  const notificationPromises = []

  // Create reply notification if this is a reply
  if (replyStatus && replyStatus.actorId !== currentActor.id) {
    notificationPromises.push(
      database.createNotification({
        actorId: replyStatus.actorId,
        type: NotificationType.enum.reply,
        sourceActorId: currentActor.id,
        statusId,
        groupKey: `reply:${replyStatus.id}`
      })
    )
  }

  // Create mention notifications
  for (const mention of mentions) {
    const mentionedActorId = mention.href
    // Don't create notification for self-mentions
    if (mentionedActorId !== currentActor.id) {
      notificationPromises.push(
        database.createNotification({
          actorId: mentionedActorId,
          type: NotificationType.enum.mention,
          sourceActorId: currentActor.id,
          statusId,
          groupKey: `mention:${statusId}`
        })
      )
    }
  }

  if (notificationPromises.length > 0) {
    await Promise.all(notificationPromises)
  }

  const status = (await database.getStatus({
    statusId,
    withReplies: false
  })) as StatusNote
  if (!status) {
    span.end()
    return null
  }

  if (fitnessFile) {
    await database.updateFitnessFileProcessingStatus(fitnessFile.id, 'pending')

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
