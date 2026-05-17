import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorProfile } from '@/lib/types/domain/actor'
import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'
import { cleanJson } from '@/lib/utils/cleanJson'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { MessagesPage } from './MessagesPage'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Activities.next: Messages'
}

const Page = async () => {
  const { host } = getConfig()
  const database = getDatabase()
  if (!database) {
    throw new Error('Failed to load database')
  }

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  if (!actor) {
    return redirect('/auth/signin')
  }

  const settings = await database.getActorSettings({ actorId: actor.id })
  const conversations = await database.getDirectConversations({
    actorId: actor.id,
    limit: 20
  })
  const conversationsWithAccounts = await Promise.all(
    conversations.map(async (conversation) => {
      const accounts = (
        await Promise.all(
          conversation.participantActorIds
            .filter((actorId) => actorId !== actor.id)
            .map((actorId) => database.getMastodonActorFromId({ id: actorId }))
        )
      ).filter((account): account is MastodonAccount => account !== null)
      return {
        ...cleanJson(conversation),
        accounts
      }
    })
  )
  const initialConversation = conversations[0] ?? null
  const initialStatuses = initialConversation
    ? await database.getDirectConversationStatuses({
        actorId: actor.id,
        conversationId: initialConversation.id,
        limit: 40
      })
    : []

  return (
    <MessagesPage
      host={host}
      conversations={conversationsWithAccounts}
      initialConversationId={initialConversation?.id ?? null}
      initialStatuses={initialStatuses.map((status) => cleanJson(status))}
      currentTime={Date.now()}
      currentActor={getActorProfile(actor)}
      postLineLimit={settings?.postLineLimit}
    />
  )
}

export default Page
