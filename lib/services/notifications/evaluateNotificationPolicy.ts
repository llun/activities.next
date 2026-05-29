import { Database } from '@/lib/database/types'
import {
  NotificationPolicyValue,
  NotificationType
} from '@/lib/types/database/operations'
import { getVisibility } from '@/lib/utils/getVisibility'

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

  const policy = await database.getNotificationPolicy({ actorId })
  if (Object.values(policy).every((value) => value === 'accept')) {
    return 'accept'
  }

  const candidates: NotificationPolicyValue[] = []

  if (
    policy.for_not_following !== 'accept' ||
    policy.for_not_followers !== 'accept'
  ) {
    const [recipientFollowsSource, sourceFollowsRecipient] = await Promise.all([
      database.isCurrentActorFollowing({
        currentActorId: actorId,
        followingActorId: sourceActorId
      }),
      database.isCurrentActorFollowing({
        currentActorId: sourceActorId,
        followingActorId: actorId
      })
    ])
    if (!recipientFollowsSource) candidates.push(policy.for_not_following)
    if (!sourceFollowsRecipient) candidates.push(policy.for_not_followers)
  }

  if (policy.for_new_accounts !== 'accept') {
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
    if (status && getVisibility(status.to, status.cc) === 'direct') {
      candidates.push(policy.for_private_mentions)
    }
  }

  return mostRestrictive(candidates)
}
