import { render } from '@testing-library/react'
import { vi } from 'vitest'

import {
  createDirectMessage,
  getConversations,
  hideConversation,
  markConversationRead,
  searchAccounts
} from '@/lib/client'
import type { DirectConversationView } from '@/lib/client'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Status, StatusNote, StatusType } from '@/lib/types/domain/status'
import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'

import { MessagesPage } from './MessagesPage'

export const currentTime = new Date('2026-05-17T12:00:00.000Z').getTime()

export const currentActor: ActorProfile = {
  id: 'https://example.com/users/me',
  username: 'me',
  domain: 'example.com',
  name: 'Me',
  followersUrl: 'https://example.com/users/me/followers',
  inboxUrl: 'https://example.com/users/me/inbox',
  sharedInboxUrl: 'https://example.com/inbox',
  followingCount: 0,
  followersCount: 0,
  statusCount: 0,
  lastStatusAt: null,
  createdAt: currentTime
}

export const account = (id: string, name: string): MastodonAccount =>
  ({
    id,
    username: name.toLowerCase(),
    acct: `${name.toLowerCase()}@example.com`,
    display_name: name,
    avatar: '',
    avatar_static: '',
    header: '',
    header_static: ''
  }) as MastodonAccount

export const status = (id: string, text: string): StatusNote => ({
  id,
  actorId: currentActor.id,
  actor: currentActor,
  to: [],
  cc: [],
  edits: [],
  isLocalActor: true,
  createdAt: currentTime,
  updatedAt: currentTime,
  type: StatusType.enum.Note,
  url: `https://example.com/statuses/${id}`,
  text,
  summary: null,
  reply: '',
  replies: [],
  actorAnnounceStatusId: null,
  isActorLiked: false,
  isActorBookmarked: false,
  totalLikes: 0,
  totalShares: 0,
  attachments: [],
  tags: []
})

export const conversation = ({
  id,
  participantName,
  unread = false
}: {
  id: string
  participantName: string
  unread?: boolean
}): DirectConversationView => ({
  id,
  actorId: currentActor.id,
  conversationId: `conversation-${id}`,
  rootStatusId: `root-${id}`,
  participantActorIds: [`https://example.com/users/${participantName}`],
  lastStatusId: `last-${id}`,
  lastStatus: status(`last-${id}`, `Last ${participantName}`),
  lastStatusCreatedAt: currentTime,
  unread,
  readAt: unread ? null : currentTime,
  hiddenAt: null,
  createdAt: currentTime,
  updatedAt: currentTime,
  accounts: [account(`account-${id}`, participantName)]
})

export const renderMessagesPage = (
  conversations: DirectConversationView[],
  initialConversationId: string | null = conversations[0]?.id ?? null,
  initialStatuses: Status[] = [],
  initialNextMaxStatusId: string | null = null,
  initialHasMoreConversations = false
) =>
  render(
    <MessagesPage
      host="example.com"
      conversations={conversations}
      initialConversationId={initialConversationId}
      initialStatuses={initialStatuses}
      initialNextMaxStatusId={initialNextMaxStatusId}
      currentActor={currentActor}
      initialHasMoreConversations={initialHasMoreConversations}
    />
  )

// Shared by every MessagesPage test file's beforeEach.
export const resetMessagesPageMocks = () => {
  vi.clearAllMocks()
  ;(createDirectMessage as jest.Mock).mockResolvedValue({})
  ;(getConversations as jest.Mock).mockResolvedValue({ conversations: [] })
  ;(hideConversation as jest.Mock).mockResolvedValue(true)
  ;(markConversationRead as jest.Mock).mockResolvedValue(true)
  ;(searchAccounts as jest.Mock).mockResolvedValue([])
}
