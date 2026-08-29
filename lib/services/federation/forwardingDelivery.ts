import { getConfig } from '@/lib/config'
import { isInboxForwardingEnabled } from '@/lib/config/federation'
import { Database } from '@/lib/database/types'
import { filterFederatedUrls } from '@/lib/services/federation/domainPolicy'
import { JobMessage } from '@/lib/services/queue/type'
import { normalizeActorId, toRecipientArray } from '@/lib/utils/activitypub'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'

export const isPublicAudience = (
  to?: string[] | string | null,
  cc?: string[] | string | null
): boolean => {
  const recipients = [...toRecipientArray(to), ...toRecipientArray(cc)]
  return recipients.some(
    (recipient) =>
      recipient === ACTIVITY_STREAM_PUBLIC ||
      recipient === ACTIVITY_STREAM_PUBLIC_COMPACT ||
      recipient === 'as:Public' ||
      recipient === 'https://www.w3.org/ns/activitystreams#Public'
  )
}

export interface IsDirectDeliveryParams {
  message: JobMessage
  authorActorId: string
  activityId?: string
}

export const isDirectDelivery = ({
  message,
  authorActorId,
  activityId
}: IsDirectDeliveryParams): boolean => {
  if (!message.verifiedSenderActorId) return false

  const normalizedSender = normalizeActorId(message.verifiedSenderActorId)
  const normalizedAuthor = normalizeActorId(authorActorId)
  if (
    !normalizedSender ||
    !normalizedAuthor ||
    normalizedSender !== normalizedAuthor
  ) {
    return false
  }

  if (
    activityId?.endsWith('#forwarded') ||
    activityId?.includes('#forwarded')
  ) {
    return false
  }
  if (typeof message.id === 'string' && message.id.includes('#forwarded')) {
    return false
  }
  if ((message as unknown as { forwarded?: boolean }).forwarded) {
    return false
  }

  return true
}

export interface GetForwardingTargetLocalActorIdsParams {
  database: Database
  inReplyTo?: string | null
  tags?: unknown
  to?: string[] | string | null
  cc?: string[] | string | null
}

export const getForwardingTargetLocalActorIds = async ({
  database,
  inReplyTo,
  tags,
  to,
  cc
}: GetForwardingTargetLocalActorIdsParams): Promise<string[]> => {
  const targetLocalActorIds = new Set<string>()

  if (inReplyTo) {
    try {
      const repliedStatus = await database.getStatus({
        statusId: inReplyTo,
        withReplies: false
      })
      if (repliedStatus) {
        const author = await database.getActorFromId({
          id: repliedStatus.actorId
        })
        if (author?.privateKey) {
          targetLocalActorIds.add(author.id)
        }
      }
    } catch {
      // Ignore lookup errors
    }
  }

  const rawTags = Array.isArray(tags) ? tags : tags ? [tags] : []
  for (const tag of rawTags) {
    if (tag && typeof tag === 'object') {
      const typedTag = tag as { type?: string; href?: string; value?: string }
      if (typedTag.type === 'Mention' || typedTag.type === 'mention') {
        const mentionActorId = typedTag.href || typedTag.value
        if (mentionActorId) {
          const actor = await database.getActorFromId({ id: mentionActorId })
          if (actor?.privateKey) {
            targetLocalActorIds.add(actor.id)
          }
        }
      }
    }
  }

  const recipients = [...toRecipientArray(to), ...toRecipientArray(cc)].filter(
    (recipient) =>
      recipient !== ACTIVITY_STREAM_PUBLIC &&
      recipient !== ACTIVITY_STREAM_PUBLIC_COMPACT &&
      recipient !== 'as:Public' &&
      recipient !== 'https://www.w3.org/ns/activitystreams#Public' &&
      !recipient.endsWith('/followers')
  )

  for (const recipient of recipients) {
    const actor = await database.getActorFromId({ id: recipient })
    if (actor?.privateKey) {
      targetLocalActorIds.add(actor.id)
    }
  }

  return [...targetLocalActorIds]
}

export interface ResolveForwardingInboxesParams {
  database: Database
  targetLocalActorIds: string[]
  authorActorId: string
  to?: string[] | string | null
  cc?: string[] | string | null
}

export const resolveForwardingInboxes = async ({
  database,
  targetLocalActorIds,
  authorActorId,
  to,
  cc
}: ResolveForwardingInboxesParams): Promise<string[]> => {
  if (targetLocalActorIds.length === 0) return []

  const rawInboxes: string[] = []
  for (const localActorId of targetLocalActorIds) {
    const inboxes = await database.getFollowersInbox({
      targetActorId: localActorId
    })
    rawInboxes.push(...inboxes)
  }

  const validInboxes = [...new Set(rawInboxes.filter(Boolean))]
  if (validInboxes.length === 0) return []

  let authorHost = ''
  try {
    authorHost = new URL(authorActorId).host.toLowerCase()
  } catch {
    // ignore
  }

  const explicitRecipientActorIds = [
    ...new Set([...toRecipientArray(to), ...toRecipientArray(cc)])
  ].filter(
    (recipient) =>
      recipient !== ACTIVITY_STREAM_PUBLIC &&
      recipient !== ACTIVITY_STREAM_PUBLIC_COMPACT &&
      recipient !== 'as:Public' &&
      recipient !== 'https://www.w3.org/ns/activitystreams#Public' &&
      !recipient.endsWith('/followers')
  )

  const explicitRecipientInboxes = new Set<string>()
  if (explicitRecipientActorIds.length > 0) {
    const explicitActors = await database.getActorsFromIds({
      ids: explicitRecipientActorIds
    })
    for (const actor of explicitActors) {
      if (actor.sharedInboxUrl)
        explicitRecipientInboxes.add(actor.sharedInboxUrl)
      if (actor.inboxUrl) explicitRecipientInboxes.add(actor.inboxUrl)
    }
    for (const id of explicitRecipientActorIds) {
      if (id.includes('/inbox')) {
        explicitRecipientInboxes.add(id)
      }
    }
  }

  const hostConfig = getConfig().host.toLowerCase()

  const filteredInboxes = validInboxes.filter((inbox) => {
    try {
      const inboxUrl = new URL(inbox)
      const inboxHost = inboxUrl.host.toLowerCase()

      if (inboxHost === hostConfig) return false
      if (authorHost && inboxHost === authorHost) return false
      if (explicitRecipientInboxes.has(inbox)) return false

      return true
    } catch {
      return false
    }
  })

  return filterFederatedUrls(database, filteredInboxes)
}

export interface ShouldForwardActivityParams {
  message: JobMessage
  authorActorId: string
  activityId?: string
  to?: string[] | string | null
  cc?: string[] | string | null
}

export const shouldForwardActivity = ({
  message,
  authorActorId,
  activityId,
  to,
  cc
}: ShouldForwardActivityParams): boolean => {
  if (!isInboxForwardingEnabled()) return false
  if (!isPublicAudience(to, cc)) return false
  if (!isDirectDelivery({ message, authorActorId, activityId })) return false

  return true
}
