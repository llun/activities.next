import { Database } from '@/lib/database/types'
import {
  NotificationPolicyValue,
  NotificationType
} from '@/lib/types/database/operations'
import { isBlueskyId } from '@/lib/utils/blueskyId'
import { getStatusVisibility } from '@/lib/utils/getVisibility'

export const isAcceptedSender = async (
  database: Database,
  actorId: string,
  sourceActorId: string
): Promise<boolean> => {
  const settings = await database.getActorSettings({ actorId })
  const accepted = settings?.notificationAcceptedSenders ?? []
  return accepted.includes(sourceActorId)
}

export const addAcceptedSender = async (
  database: Database,
  actorId: string,
  sourceActorId: string
): Promise<void> => addAcceptedSenders(database, actorId, [sourceActorId])

// Appends sourceActorIds via updateActor's appendNotificationAcceptedSenders,
// which re-reads the actor row inside a transaction (with SELECT FOR UPDATE on
// PostgreSQL) to prevent concurrent accept calls clobbering each other.
export const addAcceptedSenders = async (
  database: Database,
  actorId: string,
  sourceActorIds: string[]
): Promise<void> => {
  if (sourceActorIds.length === 0) return
  await database.updateActor({
    actorId,
    appendNotificationAcceptedSenders: sourceActorIds
  })
}

// Mastodon treats accounts younger than 30 days as "new".
const NEW_ACCOUNT_AGE_MS = 30 * 24 * 60 * 60 * 1000

const RANK: Record<NotificationPolicyValue, number> = {
  accept: 0,
  filter: 1,
  drop: 2
}

const mostRestrictive = (
  values: NotificationPolicyValue[]
): NotificationPolicyValue =>
  values.reduce<NotificationPolicyValue>(
    (worst, value) => (RANK[value] > RANK[worst] ? value : worst),
    'accept'
  )

export type EvaluateNotificationPolicyParams = {
  actorId: string
  type: NotificationType
  sourceActorId: string
  statusId?: string
  currentTime?: number
}

/**
 * Resolves whether a notification should be accepted (shown), filtered (routed
 * to the per-sender requests queue), or dropped (discarded) according to the
 * recipient's notification policy. When several dimensions match, the most
 * restrictive verdict wins (drop > filter > accept).
 *
 * `for_limited_accounts` is intentionally a no-op: this codebase has no
 * per-actor silence/limit moderation primitive (only domain-level severities),
 * so a limited-accounts policy is stored but never enforced.
 */
export const evaluateNotificationPolicy = async (
  database: Database,
  {
    actorId,
    type,
    sourceActorId,
    statusId,
    currentTime = Date.now()
  }: EvaluateNotificationPolicyParams
): Promise<NotificationPolicyValue> => {
  // Notifications from yourself (e.g. activity imports) are never filtered.
  if (sourceActorId === actorId) return 'accept'

  // Senders the user has explicitly accepted always bypass all policy dimensions.
  if (await isAcceptedSender(database, actorId, sourceActorId)) return 'accept'

  const policy = await database.getNotificationPolicy({ actorId })
  if (Object.values(policy).every((value) => value === 'accept')) {
    return 'accept'
  }

  const candidates: NotificationPolicyValue[] = []
  const isBlueskySource = isBlueskyId(sourceActorId)

  // Resolve follow relationships once; used by both for_not_following,
  // for_not_followers, and for_private_mentions (follows bypass DM filter).
  let recipientFollowsSource: boolean | undefined
  let sourceFollowsRecipient: boolean | undefined

  const needsFollowingCheck =
    policy.for_not_following !== 'accept' ||
    (policy.for_private_mentions !== 'accept' &&
      Boolean(statusId) &&
      (type === 'mention' || type === 'reply'))

  if (needsFollowingCheck || policy.for_not_followers !== 'accept') {
    if (isBlueskySource) {
      if (needsFollowingCheck) {
        recipientFollowsSource = Boolean(
          await database.getBlueskyFollow({
            actorId,
            targetActorId: sourceActorId
          })
        )
      }
      // Bluesky followers are not copied in, so treat Bluesky sources as
      // passing for_not_followers.
      sourceFollowsRecipient = true
    } else {
      ;[recipientFollowsSource, sourceFollowsRecipient] = await Promise.all([
        database.isCurrentActorFollowing({
          currentActorId: actorId,
          followingActorId: sourceActorId
        }),
        database.isCurrentActorFollowing({
          currentActorId: sourceActorId,
          followingActorId: actorId
        })
      ])
    }
  }

  if (policy.for_not_following !== 'accept' && !recipientFollowsSource) {
    candidates.push(policy.for_not_following)
  }
  if (policy.for_not_followers !== 'accept' && !sourceFollowsRecipient) {
    candidates.push(policy.for_not_followers)
  }

  // Skip for_new_accounts for Bluesky sources: their actor createdAt is when
  // this server first stored them, not when their Bluesky account was created.
  if (policy.for_new_accounts !== 'accept' && !isBlueskySource) {
    const source = await database.getActorFromId({ id: sourceActorId })
    if (source && currentTime - source.createdAt < NEW_ACCOUNT_AGE_MS) {
      candidates.push(policy.for_new_accounts)
    }
  }

  if (
    policy.for_private_mentions !== 'accept' &&
    statusId &&
    (type === 'mention' || type === 'reply')
  ) {
    const status = await database.getStatus({ statusId, withReplies: false })
    if (
      status &&
      getStatusVisibility(status) === 'direct' &&
      !recipientFollowsSource
    ) {
      // Exempt replies to threads the recipient initiated: if the replied-to
      // status was authored by actorId, the source is replying to a DM the
      // recipient sent, so it would be wrong to filter/drop the reply.
      const replyId = 'reply' in status ? (status.reply as string) : null
      const repliedToStatus = replyId
        ? await database
            .getStatus({ statusId: replyId, withReplies: false })
            .catch(() => null)
        : null
      const isReplyToRecipientStatus = repliedToStatus?.actorId === actorId

      if (!isReplyToRecipientStatus) {
        candidates.push(policy.for_private_mentions)
      }
    }
  }

  return mostRestrictive(candidates)
}
