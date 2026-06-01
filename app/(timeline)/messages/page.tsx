import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import {
  getMastodonConversationAccountMap,
  getMastodonConversationAccounts
} from '@/lib/services/mastodon/getMastodonConversation'
import { getActorProfile } from '@/lib/types/domain/actor'
import { cleanJson } from '@/lib/utils/cleanJson'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { MessagesPage } from './MessagesPage'
import { INITIAL_CONVERSATIONS_LIMIT } from './constants'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Activities.next: Messages'
}
const INITIAL_STATUS_LIMIT = 40

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

  const conversationsPage = await database.getDirectConversations({
    actorId: actor.id,
    limit: INITIAL_CONVERSATIONS_LIMIT + 1
  })
  const hasMoreInitialConversations =
    conversationsPage.length > INITIAL_CONVERSATIONS_LIMIT
  const conversations = conversationsPage.slice(0, INITIAL_CONVERSATIONS_LIMIT)
  const accountsByActorId = await getMastodonConversationAccountMap(
    database,
    conversations,
    actor.id
  )
  const conversationsWithAccounts = conversations.map((conversation) => ({
    ...cleanJson(conversation),
    accounts: getMastodonConversationAccounts(
      conversation,
      actor.id,
      accountsByActorId
    )
  }))
  const initialConversation = conversations[0] ?? null
  const initialStatusPage = initialConversation
    ? await database.getDirectConversationStatuses({
        actorId: actor.id,
        conversationId: initialConversation.id,
        limit: INITIAL_STATUS_LIMIT + 1
      })
    : []
  const hasMoreInitialStatuses = initialStatusPage.length > INITIAL_STATUS_LIMIT
  const initialStatuses = initialStatusPage.slice(0, INITIAL_STATUS_LIMIT)

  return (
    <MessagesPage
      host={host}
      conversations={conversationsWithAccounts}
      initialConversationId={initialConversation?.id ?? null}
      initialStatuses={initialStatuses.map((status) => cleanJson(status))}
      initialNextMaxStatusId={
        hasMoreInitialStatuses && initialStatuses.length > 0
          ? initialStatuses[initialStatuses.length - 1].id
          : null
      }
      currentActor={getActorProfile(actor)}
      initialHasMoreConversations={hasMoreInitialConversations}
    />
  )
}

export default Page
