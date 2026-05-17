import { Database } from '@/lib/database/types'
import { Mastodon } from '@/lib/types/activitypub'
import { DirectConversation } from '@/lib/types/database/operations'

import { getMastodonStatus } from './getMastodonStatus'

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

  return new Map(accounts.map((account) => [account.url, account] as const))
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

  const parsed = Mastodon.Conversation.safeParse({
    id: conversation.id,
    unread: conversation.unread,
    accounts: getMastodonConversationAccounts(
      conversation,
      currentActorId,
      accounts
    ),
    last_status: lastStatus
  })
  return parsed.success ? parsed.data : null
}
