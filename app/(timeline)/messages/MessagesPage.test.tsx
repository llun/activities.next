/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import {
  getConversationStatuses,
  getConversations,
  hideConversation,
  markConversationRead
} from '@/lib/client'
import type { DirectConversationView } from '@/lib/client'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Status, StatusType } from '@/lib/types/domain/status'
import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'

import { MessagesPage } from './MessagesPage'

jest.mock('@/lib/client', () => ({
  createDirectMessage: jest.fn(),
  getConversationStatuses: jest.fn(),
  getConversations: jest.fn(),
  hideConversation: jest.fn(),
  markConversationRead: jest.fn(),
  searchAccounts: jest.fn()
}))

jest.mock('@/lib/components/posts/posts', () => ({
  Posts: ({ statuses }: { statuses: Status[] }) => (
    <div>
      {statuses.map((status) => (
        <article key={status.id}>
          {status.type === 'Note' && status.text}
        </article>
      ))}
    </div>
  )
}))

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

const createDeferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const currentTime = new Date('2026-05-17T12:00:00.000Z').getTime()

const currentActor: ActorProfile = {
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

const account = (id: string, name: string): MastodonAccount =>
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

const status = (id: string, text: string): Status => ({
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

const conversation = ({
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

const renderMessagesPage = (
  conversations: DirectConversationView[],
  initialConversationId: string | null = conversations[0]?.id ?? null
) =>
  render(
    <MessagesPage
      host="example.com"
      conversations={conversations}
      initialConversationId={initialConversationId}
      initialStatuses={[]}
      initialNextMaxStatusId={null}
      currentTime={currentTime}
      currentActor={currentActor}
    />
  )

describe('MessagesPage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getConversations as jest.Mock).mockResolvedValue({ conversations: [] })
    ;(hideConversation as jest.Mock).mockResolvedValue(true)
    ;(markConversationRead as jest.Mock).mockResolvedValue(true)
  })

  it('keeps stale thread requests from overwriting the selected conversation', async () => {
    const firstThread = createDeferred<{
      statuses: Status[]
      nextMaxStatusId: string | null
      prevMinStatusId: string | null
    }>()
    const secondThread = createDeferred<{
      statuses: Status[]
      nextMaxStatusId: string | null
      prevMinStatusId: string | null
    }>()
    ;(getConversationStatuses as jest.Mock)
      .mockReturnValueOnce(firstThread.promise)
      .mockReturnValueOnce(secondThread.promise)

    renderMessagesPage([
      conversation({ id: 'first', participantName: 'Ada' }),
      conversation({ id: 'second', participantName: 'Bea' })
    ])

    fireEvent.click(screen.getByRole('button', { name: /Bea/i }))

    await act(async () => {
      secondThread.resolve({
        statuses: [status('second-status', 'Selected conversation status')],
        nextMaxStatusId: null,
        prevMinStatusId: null
      })
    })

    expect(
      await screen.findByText('Selected conversation status')
    ).toBeInTheDocument()

    await act(async () => {
      firstThread.resolve({
        statuses: [status('first-status', 'Stale conversation status')],
        nextMaxStatusId: null,
        prevMinStatusId: null
      })
    })

    await waitFor(() => {
      expect(
        screen.getByText('Selected conversation status')
      ).toBeInTheDocument()
      expect(
        screen.queryByText('Stale conversation status')
      ).not.toBeInTheDocument()
    })
  })

  it('keeps stale load-more requests from appending to a new selection', async () => {
    const initialThread = createDeferred<{
      statuses: Status[]
      nextMaxStatusId: string | null
      prevMinStatusId: string | null
    }>()
    const olderThread = createDeferred<{
      statuses: Status[]
      nextMaxStatusId: string | null
      prevMinStatusId: string | null
    }>()
    const secondThread = createDeferred<{
      statuses: Status[]
      nextMaxStatusId: string | null
      prevMinStatusId: string | null
    }>()
    ;(getConversationStatuses as jest.Mock)
      .mockReturnValueOnce(initialThread.promise)
      .mockReturnValueOnce(olderThread.promise)
      .mockReturnValueOnce(secondThread.promise)

    renderMessagesPage([
      conversation({ id: 'first', participantName: 'Ada' }),
      conversation({ id: 'second', participantName: 'Bea' })
    ])

    await act(async () => {
      initialThread.resolve({
        statuses: [status('first-status', 'First conversation status')],
        nextMaxStatusId: 'older-cursor',
        prevMinStatusId: null
      })
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))
    fireEvent.click(screen.getByRole('button', { name: /Bea/i }))

    await act(async () => {
      secondThread.resolve({
        statuses: [status('second-status', 'Selected conversation status')],
        nextMaxStatusId: null,
        prevMinStatusId: null
      })
    })

    expect(
      await screen.findByText('Selected conversation status')
    ).toBeInTheDocument()

    await act(async () => {
      olderThread.resolve({
        statuses: [status('first-older-status', 'Stale older status')],
        nextMaxStatusId: null,
        prevMinStatusId: null
      })
    })

    await waitFor(() => {
      expect(
        screen.getByText('Selected conversation status')
      ).toBeInTheDocument()
      expect(screen.queryByText('Stale older status')).not.toBeInTheDocument()
    })
  })

  it('does not mark an already-read selected conversation as read again', async () => {
    ;(getConversationStatuses as jest.Mock).mockResolvedValue({
      statuses: [],
      nextMaxStatusId: null,
      prevMinStatusId: null
    })

    renderMessagesPage([
      conversation({ id: 'first', participantName: 'Ada', unread: false })
    ])

    await waitFor(() => {
      expect(getConversationStatuses).toHaveBeenCalledWith({
        conversationId: 'first',
        limit: 40
      })
    })
    expect(markConversationRead).not.toHaveBeenCalled()
  })
})
