import { Database } from '@/lib/database/types'
import { Mastodon } from '@/lib/types/activitypub'
import { DirectConversation } from '@/lib/types/database/operations'
import { normalizeActorId } from '@/lib/utils/activitypub'
import { idToUrl } from '@/lib/utils/urlToId'

import { getMastodonStatus, getMastodonStatuses } from './getMastodonStatus'

export type MastodonConversationAccountMap = Map<string, Mastodon.Account>

export const getMastodonConversationAccountMap = async (
  database: Database,
  conversations: DirectConversation[],
  currentActorId: string
): Promise<MastodonConversationAccountMap> => {
  const participantActorIds = [
    ...new Set(
      conversations.flatMap((conversation) =>
        conversation.participantActorIds.filter(
          (actorId) => actorId !== currentActorId
        )
      )
    )
  ]
  if (participantActorIds.length === 0) return new Map()

  const accounts = await database.getMastodonActorsFromIds({
    ids: participantActorIds
  })

  // Index by normalized actor URI so accounts can be matched regardless of
  // URI fragment or host casing differences. The accountMap remains keyed
  // by the original participantActorId so callers can look up by the value
  // stored in the conversation row.
  const requestedActorIdByNormalized = new Map<string, string>()
  for (const actorId of participantActorIds) {
    const normalized = normalizeActorId(actorId)
    if (normalized) requestedActorIdByNormalized.set(normalized, actorId)
  }

  const accountMap: MastodonConversationAccountMap = new Map()

  for (const account of accounts) {
    const decodedActorId =
      typeof account.id === 'string' ? idToUrl(account.id) : ''
    const candidates = [decodedActorId, account.url].filter(Boolean)
    for (const candidate of candidates) {
      const normalized = normalizeActorId(candidate)
      if (!normalized) continue
      const originalActorId = requestedActorIdByNormalized.get(normalized)
      if (originalActorId && !accountMap.has(originalActorId)) {
        accountMap.set(originalActorId, account)
        break
      }
    }
  }

  return accountMap
}

export const getMastodonConversationAccounts = (
  conversation: DirectConversation,
  currentActorId: string,
  accountsByActorId: MastodonConversationAccountMap
): Mastodon.Account[] =>
  conversation.participantActorIds
    .filter((actorId) => actorId !== currentActorId)
    .map((actorId) => accountsByActorId.get(actorId))
    .filter((account): account is Mastodon.Account => account !== undefined)

const buildMastodonConversation = (
  conversation: DirectConversation,
  currentActorId: string,
  accountsByActorId: MastodonConversationAccountMap,
  lastStatus: Mastodon.Status | null
): Mastodon.Conversation | null => {
  const parsed = Mastodon.Conversation.safeParse({
    id: conversation.id,
    unread: conversation.unread,
    accounts: getMastodonConversationAccounts(
      conversation,
      currentActorId,
      accountsByActorId
    ),
    last_status: lastStatus
  })
  return parsed.success ? parsed.data : null
}

export const getMastodonConversation = async (
  database: Database,
  conversation: DirectConversation,
  currentActorId: string,
  accountsByActorId?: MastodonConversationAccountMap
): Promise<Mastodon.Conversation | null> => {
  const accounts =
    accountsByActorId ??
    (await getMastodonConversationAccountMap(
      database,
      [conversation],
      currentActorId
    ))
  const lastStatus = await getMastodonStatus(
    database,
    conversation.lastStatus,
    currentActorId
  )

  return buildMastodonConversation(
    conversation,
    currentActorId,
    accounts,
    lastStatus
  )
}

export const getMastodonConversations = async (
  database: Database,
  conversations: DirectConversation[],
  currentActorId: string,
  accountsByActorId?: MastodonConversationAccountMap
): Promise<Mastodon.Conversation[]> => {
  if (conversations.length === 0) return []

  const accounts =
    accountsByActorId ??
    (await getMastodonConversationAccountMap(
      database,
      conversations,
      currentActorId
    ))
  const lastStatuses = await getMastodonStatuses(
    database,
    conversations.map((conversation) => conversation.lastStatus),
    currentActorId
  )
  const lastStatusByUri = new Map(
    lastStatuses.map((status) => [status.uri, status] as const)
  )

  return conversations
    .map((conversation) =>
      buildMastodonConversation(
        conversation,
        currentActorId,
        accounts,
        lastStatusByUri.get(conversation.lastStatus.id) ?? null
      )
    )
    .filter(
      (conversation): conversation is Mastodon.Conversation =>
        conversation !== null
    )
}
