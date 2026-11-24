// Pulls Bluesky notifications for a local actor's linked account and turns
// them into local notifications (with push and email alerts). Called from
// syncBlueskyHome after the Home timeline part of each successful run.
//
// The notification list itself comes from the user's PDS (it is the user's own
// data), but every stored post and author is re-read from the public AppView
// (./appview), never from the PDS's answer.
import type { Database } from '@/lib/database/types'
import { resolveActorEmailBrand } from '@/lib/services/email/sender'
import { buildLikeEmail } from '@/lib/services/email/templates/like'
import { buildMentionEmail } from '@/lib/services/email/templates/mention'
import { buildBoostEmail } from '@/lib/services/email/templates/reblog'
import { buildReplyEmail } from '@/lib/services/email/templates/reply'
import { createNotificationWithPolicy } from '@/lib/services/notifications/createNotificationWithPolicy'
import {
  type EmailContent,
  sendNotificationAlerts
} from '@/lib/services/notifications/sendNotificationAlerts'
import { NotificationType } from '@/lib/types/database/operations'
import type { Actor } from '@/lib/types/domain/actor'
import {
  type EditableStatus,
  getOriginalStatus
} from '@/lib/types/domain/status'
import { BLUESKY_DID_PATTERN } from '@/lib/utils/accountHandle'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { isRecord } from '@/lib/utils/typeGuards'

import { type BlueskyAgent, BlueskySessionChangedError } from './agent'
import { getPublicPosts, getPublicProfiles } from './appview'
import { isBlueskyAllowed } from './policy'
import {
  type BlueskyPostView,
  blueskyPostId,
  optionalString,
  parseAtUri,
  parseBlueskyPostView,
  storeBlueskyAuthor,
  storeBlueskyPostView
} from './records'

const PAGE_LIMIT = 50
const MAX_PAGES = 2
const POST_COLLECTION = 'app.bsky.feed.post'
const DEDUP_SCAN_LIMIT = 100

type HandledReason = 'like' | 'repost' | 'reply' | 'mention' | 'quote'

type NotificationCandidate = {
  reason: HandledReason
  authorDid: string
  postUri: string
}

type UnseenEntry = {
  indexedAt: number
  candidate: NotificationCandidate | null
}

const isHandledReason = (value: unknown): value is HandledReason =>
  value === 'like' ||
  value === 'repost' ||
  value === 'reply' ||
  value === 'mention' ||
  value === 'quote'

const parseCandidate = (
  item: Record<string, unknown>,
  userDid: string
): NotificationCandidate | null => {
  if (!isHandledReason(item.reason)) return null
  const authorDid = isRecord(item.author)
    ? optionalString(item.author.did)
    : undefined
  if (!authorDid || !BLUESKY_DID_PATTERN.test(authorDid)) return null
  if (authorDid === userDid) return null

  const postUri =
    item.reason === 'like' || item.reason === 'repost'
      ? optionalString(item.reasonSubject)
      : optionalString(item.uri)
  if (!postUri) return null
  const at = parseAtUri(postUri)
  if (!at || at.collection !== POST_COLLECTION) return null

  if (item.reason === 'like' || item.reason === 'repost') {
    if (at.did !== userDid) return null
  } else if (at.did !== authorDid) {
    return null
  }

  return { reason: item.reason, authorDid, postUri }
}

const readPublicPosts = async (uris: string[]) => {
  const views = new Map<string, BlueskyPostView>()
  if (uris.length === 0) return views
  for (const value of await getPublicPosts(uris)) {
    const post = parseBlueskyPostView(value)
    if (post) views.set(post.uri, post)
  }
  return views
}

const readPublicProfiles = async (dids: string[]) => {
  const profiles = new Map<string, Record<string, unknown>>()
  if (dids.length === 0) return profiles
  for (const value of await getPublicProfiles(dids)) {
    if (!isRecord(value)) continue
    const did = optionalString(value.did)
    if (did && BLUESKY_DID_PATTERN.test(did)) {
      profiles.set(did, value)
    }
  }
  return profiles
}

const replyParentStatusId = (post: BlueskyPostView): string | null => {
  if (!isRecord(post.record.reply) || !isRecord(post.record.reply.parent)) {
    return null
  }
  const at = parseAtUri(optionalString(post.record.reply.parent.uri) ?? '')
  return at?.collection === POST_COLLECTION
    ? blueskyPostId(at.did, at.rkey)
    : null
}

const extractRecordUri = (value: unknown): string | undefined =>
  isRecord(value) ? optionalString(value.uri) : undefined

const quotedPostStatusId = (post: BlueskyPostView): string | null => {
  const embed = isRecord(post.record.embed)
    ? post.record.embed
    : isRecord(post.view.embed)
      ? post.view.embed
      : null
  if (!embed) return null
  let uri: string | undefined
  if (
    embed.$type === 'app.bsky.embed.record' ||
    embed.$type === 'app.bsky.embed.record#view'
  ) {
    uri = extractRecordUri(embed.record)
  } else if (
    embed.$type === 'app.bsky.embed.recordWithMedia' ||
    embed.$type === 'app.bsky.embed.recordWithMedia#view'
  ) {
    uri = isRecord(embed.record)
      ? extractRecordUri(embed.record.record)
      : undefined
  }
  const at = uri ? parseAtUri(uri) : null
  return at?.collection === POST_COLLECTION
    ? blueskyPostId(at.did, at.rkey)
    : null
}

const notificationSpec = (
  reason: HandledReason,
  statusId: string,
  post: BlueskyPostView
): { type: NotificationType; groupKey: string } => {
  switch (reason) {
    case 'like':
      return { type: NotificationType.enum.like, groupKey: `like:${statusId}` }
    case 'repost':
      return {
        type: NotificationType.enum.reblog,
        groupKey: `reblog:${statusId}`
      }
    case 'reply':
      return {
        type: NotificationType.enum.reply,
        groupKey: `reply:${replyParentStatusId(post) ?? statusId}`
      }
    case 'mention':
      return {
        type: NotificationType.enum.mention,
        groupKey: `mention:${statusId}`
      }
    case 'quote':
      return {
        type: NotificationType.enum.quote,
        groupKey: `quote:${quotedPostStatusId(post) ?? statusId}`
      }
  }
}

const hasExistingNotification = async (
  database: Database,
  {
    actorId,
    type,
    sourceActorId,
    statusId
  }: {
    actorId: string
    type: NotificationType
    sourceActorId: string
    statusId: string
  }
): Promise<boolean> => {
  const existing = await database.getNotifications({
    actorId,
    sourceActorId,
    types: [type],
    includeFiltered: true,
    limit: DEDUP_SCAN_LIMIT
  })
  return existing.some((notification) => notification.statusId === statusId)
}

const buildEmailForType = (
  type: NotificationType,
  params: {
    recipient: Actor
    brand: Awaited<ReturnType<typeof resolveActorEmailBrand>>
    actor: Actor
    status: EditableStatus
  }
) => {
  switch (type) {
    case NotificationType.enum.like:
      return buildLikeEmail(params)
    case NotificationType.enum.reblog:
      return buildBoostEmail(params)
    case NotificationType.enum.reply:
      return buildReplyEmail(params)
    case NotificationType.enum.mention:
      return buildMentionEmail(params)
    default:
      return null
  }
}

const dispatchNotificationAlerts = async (
  database: Database,
  {
    actor,
    type,
    sourceActorId,
    statusId,
    notificationId
  }: {
    actor: Actor
    type: NotificationType
    sourceActorId: string
    statusId: string
    notificationId: string
  }
) => {
  try {
    const [targetActor, sourceActor, status] = await Promise.all([
      actor.account ? actor : database.getActorFromId({ id: actor.id }),
      database.getActorFromId({ id: sourceActorId }),
      database.getStatus({ statusId, withReplies: false })
    ])
    if (!sourceActor) return
    const editableStatus = status ? getOriginalStatus(status) : null
    let emailContent: EmailContent | undefined
    if (targetActor?.account && editableStatus) {
      const rendered = buildEmailForType(type, {
        recipient: targetActor,
        brand: await resolveActorEmailBrand(database, targetActor),
        actor: sourceActor,
        status: editableStatus
      })
      if (rendered) {
        emailContent = {
          recipientEmail: targetActor.account.email,
          ...rendered
        }
      }
    }
    sendNotificationAlerts({
      database,
      actorId: actor.id,
      sourceActorId,
      sourceActor,
      statusId,
      events: [
        {
          type,
          notificationId,
          ...(emailContent ? { emailContent } : null)
        }
      ]
    })
  } catch (error) {
    logger.warn({
      message: 'Failed to dispatch Bluesky notification alerts',
      actorId: actor.id,
      notificationId,
      err: toLoggableError(error)
    })
  }
}

// Re-checks that the actor is still linked to the same DID before mutating
// seenAt or creating notifications: returns false if unlinked, throws on relink.
const ensureSameLink = async (
  database: Database,
  actorId: string,
  agentDid: string
): Promise<boolean> => {
  const link = await database.getBlueskyAccount({ actorId })
  if (!link) return false
  if (link.did !== agentDid) throw new BlueskySessionChangedError()
  return true
}

/**
 * Syncs Bluesky notifications (like, repost, reply, mention, quote) for a local
 * actor into the local notifications table and dispatches push/email alerts.
 *
 * First run (notificationsSeenAt === null): initializes the watermark to the
 * newest notification indexedAt (or now if none) without copying older
 * notifications. Later runs process unseen notifications (indexedAt > seenAt)
 * oldest-first, re-reading every stored post and author from the public AppView.
 */
export const syncBlueskyNotifications = async (
  database: Database,
  actor: Actor,
  agent: BlueskyAgent
): Promise<void> => {
  if (!(await isBlueskyAllowed(database))) return

  const account = await database.getBlueskyAccount({ actorId: actor.id })
  if (!account) return
  if (account.did !== agent.did) throw new BlueskySessionChangedError()

  if (account.notificationsSeenAt === null) {
    const response = await agent.get<{ notifications?: unknown }>(
      'app.bsky.notification.listNotifications',
      { limit: PAGE_LIMIT }
    )
    const list = (
      Array.isArray(response?.notifications) ? response.notifications : []
    ).slice(0, PAGE_LIMIT)
    let newestIndexedAt: number | null = null
    for (const item of list) {
      if (!isRecord(item)) continue
      const indexedAt = Date.parse(optionalString(item.indexedAt) ?? '')
      if (!Number.isFinite(indexedAt)) continue
      if (newestIndexedAt === null || indexedAt > newestIndexedAt) {
        newestIndexedAt = indexedAt
      }
    }
    if (!(await ensureSameLink(database, actor.id, agent.did))) return
    await database.updateBlueskyNotificationsSeenAt({
      actorId: actor.id,
      seenAt: newestIndexedAt ?? Date.now()
    })
    return
  }

  const seenAt = account.notificationsSeenAt
  const unseen: UnseenEntry[] = []
  let cursor: string | undefined

  pages: for (let page = 0; page < MAX_PAGES; page++) {
    const response = await agent.get<{
      notifications?: unknown
      cursor?: unknown
    }>('app.bsky.notification.listNotifications', {
      limit: PAGE_LIMIT,
      cursor
    })
    const list = (
      Array.isArray(response?.notifications) ? response.notifications : []
    ).slice(0, PAGE_LIMIT)
    for (const item of list) {
      if (!isRecord(item)) continue
      const indexedAt = Date.parse(optionalString(item.indexedAt) ?? '')
      if (!Number.isFinite(indexedAt)) continue
      if (indexedAt <= seenAt) break pages
      unseen.push({
        indexedAt,
        candidate: parseCandidate(item, agent.did)
      })
    }
    cursor = optionalString(response?.cursor)
    if (!cursor || list.length === 0) break
  }

  if (unseen.length === 0) return

  const candidates = unseen
    .map((entry) => entry.candidate)
    .filter((c): c is NotificationCandidate => c !== null)

  const [profiles, posts] = await Promise.all([
    readPublicProfiles(candidates.map((c) => c.authorDid)),
    readPublicPosts(candidates.map((c) => c.postUri))
  ])

  // Oldest first so notifications arrive in order and seenAt advances safely.
  const ordered = [...unseen]
    .reverse()
    .sort((a, b) => a.indexedAt - b.indexedAt)

  for (let index = 0; index < ordered.length; index++) {
    const entry = ordered[index]
    const { candidate } = entry

    if (candidate) {
      if (!(await ensureSameLink(database, actor.id, agent.did))) return
      const profile = profiles.get(candidate.authorDid)
      const post = posts.get(candidate.postUri)
      const authorMatches =
        post &&
        (candidate.reason === 'like' || candidate.reason === 'repost'
          ? post.at.did === agent.did
          : post.at.did === candidate.authorDid)

      if (profile && post && authorMatches) {
        try {
          const sourceActorId = await storeBlueskyAuthor(database, profile, {
            full: true
          })
          const statusId = sourceActorId
            ? await storeBlueskyPostView(database, post)
            : null

          if (sourceActorId && statusId) {
            const { type, groupKey } = notificationSpec(
              candidate.reason,
              statusId,
              post
            )
            const duplicate = await hasExistingNotification(database, {
              actorId: actor.id,
              type,
              sourceActorId,
              statusId
            })
            if (!duplicate) {
              const notification = await createNotificationWithPolicy(
                database,
                {
                  actorId: actor.id,
                  type,
                  sourceActorId,
                  statusId,
                  groupKey
                }
              )
              if (notification && !notification.filtered) {
                await dispatchNotificationAlerts(database, {
                  actor,
                  type,
                  sourceActorId,
                  statusId,
                  notificationId: notification.id
                })
              }
            }
          }
        } catch (error) {
          if (error instanceof BlueskySessionChangedError) throw error
          logger.warn({
            message: 'Skipped a Bluesky notification that could not be stored',
            actorId: actor.id,
            uri: candidate.postUri,
            err: toLoggableError(error)
          })
        }
      }
    }

    // Advance seenAt once every notification sharing this timestamp is done,
    // so a crash between same-millisecond items never drops the rest while
    // dedup protects any already-created row on retry.
    const next = ordered[index + 1]
    if (!next || next.indexedAt > entry.indexedAt) {
      if (!(await ensureSameLink(database, actor.id, agent.did))) return
      await database.updateBlueskyNotificationsSeenAt({
        actorId: actor.id,
        seenAt: entry.indexedAt
      })
    }
  }
}
