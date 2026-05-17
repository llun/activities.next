import { Database } from '@/lib/database/types'
import { Mastodon } from '@/lib/types/activitypub'
import { DirectConversation } from '@/lib/types/database/operations'

import { getMastodonStatus } from './getMastodonStatus'

export const getMastodonConversation = async (
  database: Database,
  conversation: DirectConversation,
  currentActorId: string
): Promise<Mastodon.Conversation | null> => {
  const accounts = (
    await Promise.all(
      conversation.participantActorIds
        .filter((actorId) => actorId !== currentActorId)
        .map((actorId) => database.getMastodonActorFromId({ id: actorId }))
    )
  ).filter((account): account is Mastodon.Account => account !== null)
  const lastStatus = await getMastodonStatus(
    database,
    conversation.lastStatus,
    currentActorId
  )

  const parsed = Mastodon.Conversation.safeParse({
    id: conversation.id,
    unread: conversation.unread,
    accounts,
    last_status: lastStatus
  })
  return parsed.success ? parsed.data : null
}
