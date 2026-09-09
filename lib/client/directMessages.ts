import type { Status } from '@/lib/types/domain/status'
import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'
import { normalizeActorId } from '@/lib/utils/activitypub'
import { idToUrl } from '@/lib/utils/urlToId'

const accountMention = (account: MastodonAccount) =>
  `@${account.acct || account.username}`

const getReplyParticipantIds = (replyStatus: Status) =>
  new Set(
    [replyStatus.actorId, ...replyStatus.to, ...replyStatus.cc]
      .map((id) => normalizeActorId(id))
      .filter((id): id is string => Boolean(id))
  )

const isReplyParticipant = (
  account: MastodonAccount,
  replyParticipantIds: Set<string>
) => {
  // The participant set holds ActivityPub actor URIs, so `uri` is the only
  // encoding-independent key. `url` is a profile URL (`/@name`) on some
  // accounts, and `id` is a publicId that cannot be decoded back to a URI at
  // all, so both stay as fallbacks for entities built before the id flip.
  for (const candidate of [account.uri, account.url, idToUrl(account.id)]) {
    if (!candidate) continue
    const accountActorId = normalizeActorId(candidate)
    if (accountActorId && replyParticipantIds.has(accountActorId)) return true
  }
  return false
}

export interface CreateDirectMessageResult {
  uri: string
  [key: string]: unknown
}

export interface CreateDirectMessageParams {
  message: string
  recipients: MastodonAccount[]
  replyStatus?: Status
}

export const createDirectMessage = async ({
  message,
  recipients,
  replyStatus
}: CreateDirectMessageParams): Promise<CreateDirectMessageResult> => {
  const normalizedMessage = message.trim()
  if (!normalizedMessage) {
    throw new Error('Message must not be empty')
  }
  if (recipients.length === 0 && !replyStatus) {
    throw new Error('At least one recipient is required')
  }

  const replyParticipantIds = replyStatus
    ? getReplyParticipantIds(replyStatus)
    : null
  const recipientsToMention = replyParticipantIds
    ? recipients.filter(
        (recipient) => !isReplyParticipant(recipient, replyParticipantIds)
      )
    : recipients
  const mentionPrefix = recipientsToMention.map(accountMention).join(' ')
  const status = [mentionPrefix, normalizedMessage].filter(Boolean).join(' ')
  const response = await fetch('/api/v1/statuses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    // `replyStatus.id` is the raw AP URI of the status being replied to; POST
    // /api/v1/statuses resolves `in_reply_to_id` through resolveStatusIdParam,
    // which passes a raw URI straight through, so send it unencoded.
    body: JSON.stringify({
      status,
      visibility: 'direct',
      ...(replyStatus ? { in_reply_to_id: replyStatus.id } : {})
    })
  })
  if (!response.ok) {
    throw new Error('Failed to send message')
  }
  return (await response.json()) as CreateDirectMessageResult
}
