/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'

import {
  createDirectMessage,
  getConversationStatuses,
  getConversations,
  hideConversation,
  markConversationRead,
  searchAccounts
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
  reject: (error: Error) => void
}

const createDeferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
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
      currentTime={currentTime}
      currentActor={currentActor}
      initialHasMoreConversations={initialHasMoreConversations}
    />
  )

describe('MessagesPage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(createDirectMessage as jest.Mock).mockResolvedValue({})
    ;(getConversations as jest.Mock).mockResolvedValue({ conversations: [] })
    ;(hideConversation as jest.Mock).mockResolvedValue(true)
    ;(markConversationRead as jest.Mock).mockResolvedValue(true)
    ;(searchAccounts as jest.Mock).mockResolvedValue([])
  })

  it('keeps stale thread requests from overwriting the selected conversation', async () => {
    const firstThread = createDeferred<{
      statuses: Status[]
      nextMaxStatusId: string | null
    }>()
    const secondThread = createDeferred<{
      statuses: Status[]
      nextMaxStatusId: string | null
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
        nextMaxStatusId: null
      })
    })

    expect(
      await screen.findByText('Selected conversation status')
    ).toBeInTheDocument()

    await act(async () => {
      firstThread.resolve({
        statuses: [status('first-status', 'Stale conversation status')],
        nextMaxStatusId: null
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
    }>()
    const olderThread = createDeferred<{
      statuses: Status[]
      nextMaxStatusId: string | null
    }>()
    const secondThread = createDeferred<{
      statuses: Status[]
      nextMaxStatusId: string | null
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
        nextMaxStatusId: 'older-cursor'
      })
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))
    fireEvent.click(screen.getByRole('button', { name: /Bea/i }))

    await act(async () => {
      secondThread.resolve({
        statuses: [status('second-status', 'Selected conversation status')],
        nextMaxStatusId: null
      })
    })

    expect(
      await screen.findByText('Selected conversation status')
    ).toBeInTheDocument()

    await act(async () => {
      olderThread.resolve({
        statuses: [status('first-older-status', 'Stale older status')],
        nextMaxStatusId: null
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
      nextMaxStatusId: null
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

  it('restores unread state when marking the selected conversation read fails', async () => {
    const markRead = createDeferred<boolean>()
    ;(getConversationStatuses as jest.Mock).mockResolvedValue({
      statuses: [],
      nextMaxStatusId: null
    })
    ;(markConversationRead as jest.Mock).mockReturnValue(markRead.promise)

    renderMessagesPage([
      conversation({ id: 'first', participantName: 'Ada', unread: true })
    ])

    await waitFor(() => {
      expect(
        within(screen.getByRole('button', { name: /Ada/i })).getByText('Ada')
      ).not.toHaveClass('font-semibold')
    })

    await act(async () => {
      markRead.reject(new Error('read failed'))
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not mark conversation as read'
    )
    expect(
      within(screen.getByRole('button', { name: /Ada/i })).getByText('Ada')
    ).toHaveClass('font-semibold')
    expect(markConversationRead).toHaveBeenCalledTimes(1)
  })

  it('keeps the current thread visible while refreshing after sending a message', async () => {
    const refreshedThread = createDeferred<{
      statuses: Status[]
      nextMaxStatusId: string | null
    }>()
    const conversations = [
      conversation({ id: 'first', participantName: 'Ada' })
    ]
    ;(getConversationStatuses as jest.Mock)
      .mockResolvedValueOnce({
        statuses: [status('first-status', 'Existing status')],
        nextMaxStatusId: null
      })
      .mockReturnValueOnce(refreshedThread.promise)
    ;(getConversations as jest.Mock).mockResolvedValue({ conversations })

    renderMessagesPage(conversations, 'first', [
      status('initial-status', 'Existing status')
    ])

    expect(await screen.findByText('Existing status')).toBeInTheDocument()

    const messageInput = screen.getByPlaceholderText('Write a message')
    fireEvent.change(messageInput, { target: { value: 'Reply' } })
    fireEvent.submit(messageInput.closest('form')!)

    await waitFor(() => {
      expect(getConversationStatuses).toHaveBeenCalledTimes(2)
    })

    expect(screen.getByText('Existing status')).toBeInTheDocument()
    expect(screen.queryByText('Refreshed status')).not.toBeInTheDocument()

    await act(async () => {
      refreshedThread.resolve({
        statuses: [status('refreshed-status', 'Refreshed status')],
        nextMaxStatusId: null
      })
    })

    expect(await screen.findByText('Refreshed status')).toBeInTheDocument()
  })

  it('scrolls the message thread to the bottom when displayed statuses change', async () => {
    const threadLoad = createDeferred<{
      statuses: Status[]
      nextMaxStatusId: string | null
    }>()
    ;(getConversationStatuses as jest.Mock).mockReturnValue(threadLoad.promise)

    renderMessagesPage([conversation({ id: 'first', participantName: 'Ada' })])

    const thread = screen.getByLabelText('Message thread')
    Object.defineProperty(thread, 'scrollHeight', {
      configurable: true,
      value: 640
    })

    await act(async () => {
      threadLoad.resolve({
        statuses: [status('first-status', 'First status')],
        nextMaxStatusId: null
      })
    })

    await waitFor(() => {
      expect(thread.scrollTop).toBe(640)
    })
  })

  it('preserves the visible thread position when loading older statuses', async () => {
    const initialThread = createDeferred<{
      statuses: Status[]
      nextMaxStatusId: string | null
    }>()
    const olderThread = createDeferred<{
      statuses: Status[]
      nextMaxStatusId: string | null
    }>()
    ;(getConversationStatuses as jest.Mock)
      .mockReturnValueOnce(initialThread.promise)
      .mockReturnValueOnce(olderThread.promise)

    renderMessagesPage([conversation({ id: 'first', participantName: 'Ada' })])

    const thread = screen.getByLabelText('Message thread')
    Object.defineProperty(thread, 'scrollHeight', {
      configurable: true,
      value: 600
    })

    await act(async () => {
      initialThread.resolve({
        statuses: [
          status('newest-status', 'Newest status'),
          status('middle-status', 'Middle status')
        ],
        nextMaxStatusId: 'older-cursor'
      })
    })

    expect(await screen.findByText('Middle status')).toBeInTheDocument()
    await waitFor(() => {
      expect(thread.scrollTop).toBe(600)
    })

    thread.scrollTop = 240
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    Object.defineProperty(thread, 'scrollHeight', {
      configurable: true,
      value: 900
    })

    await act(async () => {
      olderThread.resolve({
        statuses: [status('oldest-status', 'Oldest status')],
        nextMaxStatusId: null
      })
    })

    expect(await screen.findByText('Oldest status')).toBeInTheDocument()
    await waitFor(() => {
      expect(thread.scrollTop).toBe(540)
    })
  })

  it('does not let stale load-more requests clear the active scroll anchor', async () => {
    const initialThread = createDeferred<{
      statuses: Status[]
      nextMaxStatusId: string | null
    }>()
    const staleOlderThread = createDeferred<{
      statuses: Status[]
      nextMaxStatusId: string | null
    }>()
    const secondThread = createDeferred<{
      statuses: Status[]
      nextMaxStatusId: string | null
    }>()
    const reloadedThread = createDeferred<{
      statuses: Status[]
      nextMaxStatusId: string | null
    }>()
    const activeOlderThread = createDeferred<{
      statuses: Status[]
      nextMaxStatusId: string | null
    }>()
    ;(getConversationStatuses as jest.Mock)
      .mockReturnValueOnce(initialThread.promise)
      .mockReturnValueOnce(staleOlderThread.promise)
      .mockReturnValueOnce(secondThread.promise)
      .mockReturnValueOnce(reloadedThread.promise)
      .mockReturnValueOnce(activeOlderThread.promise)

    renderMessagesPage([
      conversation({ id: 'first', participantName: 'Ada' }),
      conversation({ id: 'second', participantName: 'Bea' })
    ])

    const thread = screen.getByLabelText('Message thread')
    Object.defineProperty(thread, 'scrollHeight', {
      configurable: true,
      value: 600
    })

    await act(async () => {
      initialThread.resolve({
        statuses: [status('first-newest', 'First newest')],
        nextMaxStatusId: 'older-cursor'
      })
    })
    expect(await screen.findByText('First newest')).toBeInTheDocument()

    thread.scrollTop = 240
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    fireEvent.click(screen.getByRole('button', { name: /Bea/i }))

    await act(async () => {
      secondThread.resolve({
        statuses: [status('second-newest', 'Second newest')],
        nextMaxStatusId: null
      })
    })
    expect(await screen.findByText('Second newest')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Ada/i }))
    await act(async () => {
      reloadedThread.resolve({
        statuses: [status('first-newest', 'First newest')],
        nextMaxStatusId: 'older-cursor'
      })
    })
    expect(await screen.findByText('First newest')).toBeInTheDocument()

    thread.scrollTop = 240
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    Object.defineProperty(thread, 'scrollHeight', {
      configurable: true,
      value: 900
    })

    await act(async () => {
      staleOlderThread.resolve({
        statuses: [status('stale-older', 'Stale older')],
        nextMaxStatusId: null
      })
      activeOlderThread.resolve({
        statuses: [status('active-older', 'Active older')],
        nextMaxStatusId: null
      })
    })

    expect(await screen.findByText('Active older')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText('Stale older')).not.toBeInTheDocument()
      expect(thread.scrollTop).toBe(540)
    })
  })

  it('sends the message with Enter and preserves Shift+Enter for a newline', async () => {
    ;(getConversationStatuses as jest.Mock).mockResolvedValue({
      statuses: [],
      nextMaxStatusId: null
    })
    ;(getConversations as jest.Mock).mockResolvedValue({
      conversations: [conversation({ id: 'first', participantName: 'Ada' })]
    })

    renderMessagesPage([conversation({ id: 'first', participantName: 'Ada' })])

    const messageInput = screen.getByPlaceholderText('Write a message')
    fireEvent.change(messageInput, { target: { value: 'Line one' } })

    expect(
      fireEvent.keyDown(messageInput, { key: 'Enter', shiftKey: true })
    ).toBe(true)
    expect(createDirectMessage).not.toHaveBeenCalled()

    fireEvent.keyDown(messageInput, { key: 'Enter' })

    await waitFor(() => {
      expect(createDirectMessage).toHaveBeenCalledWith({
        message: 'Line one',
        recipients: [expect.objectContaining({ display_name: 'Ada' })],
        replyStatus: expect.objectContaining({ id: 'last-first' })
      })
    })
  })

  it('lists recipient search results and adds the chosen account on click', async () => {
    ;(getConversationStatuses as jest.Mock).mockResolvedValue({
      statuses: [],
      nextMaxStatusId: null
    })
    ;(searchAccounts as jest.Mock).mockResolvedValue([
      account('account-ada', 'Ada'),
      account('account-adam', 'Adam')
    ])

    renderMessagesPage([], null)

    const recipientInput = screen.getByPlaceholderText('@user@example.com')
    fireEvent.change(recipientInput, { target: { value: 'ad' } })
    fireEvent.keyDown(recipientInput, { key: 'Enter' })

    const resultsList = await screen.findByLabelText('Recipient search results')
    expect(within(resultsList).getByText('Ada')).toBeInTheDocument()
    expect(within(resultsList).getByText('Adam')).toBeInTheDocument()
    expect(searchAccounts).toHaveBeenCalledWith({
      q: 'ad',
      resolve: true,
      limit: 5
    })

    fireEvent.click(within(resultsList).getByText('Adam'))

    expect(
      screen.queryByLabelText('Recipient search results')
    ).not.toBeInTheDocument()
    expect(screen.getByText('Adam')).toBeInTheDocument()
  })

  it('loads additional conversations when the user clicks Load more in the sidebar', async () => {
    ;(getConversationStatuses as jest.Mock).mockResolvedValue({
      statuses: [],
      nextMaxStatusId: null
    })
    ;(getConversations as jest.Mock).mockResolvedValue({
      conversations: [conversation({ id: 'older', participantName: 'Bea' })]
    })

    renderMessagesPage(
      [conversation({ id: 'newest', participantName: 'Ada' })],
      'newest',
      [],
      null,
      true
    )

    const sidebarLoadMore = screen.getByRole('button', { name: 'Load more' })
    fireEvent.click(sidebarLoadMore)

    await waitFor(() => {
      expect(getConversations).toHaveBeenCalledWith({
        limit: 21,
        maxId: 'newest'
      })
    })

    expect(await screen.findByText('Bea')).toBeInTheDocument()
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'Load more' })
      ).not.toBeInTheDocument()
    })
  })

  it('keeps the Load more button when the server still has more conversations', async () => {
    ;(getConversationStatuses as jest.Mock).mockResolvedValue({
      statuses: [],
      nextMaxStatusId: null
    })
    const extraConversations = Array.from({ length: 21 }, (_, index) =>
      conversation({ id: `extra-${index}`, participantName: `Person${index}` })
    )
    ;(getConversations as jest.Mock).mockResolvedValue({
      conversations: extraConversations
    })

    renderMessagesPage(
      [conversation({ id: 'newest', participantName: 'Ada' })],
      'newest',
      [],
      null,
      true
    )

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    await waitFor(() => {
      expect(getConversations).toHaveBeenCalledTimes(1)
    })

    // After loading, 21 fetched + 1 existing = 22; only the first 20 fetched
    // should be appended and the Load more button should remain.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Load more' })).toBeEnabled()
    })
  })

  it('shows an error and keeps the Load more button when loading more conversations fails', async () => {
    ;(getConversationStatuses as jest.Mock).mockResolvedValue({
      statuses: [],
      nextMaxStatusId: null
    })
    ;(getConversations as jest.Mock).mockRejectedValue(new Error('boom'))

    renderMessagesPage(
      [conversation({ id: 'newest', participantName: 'Ada' })],
      'newest',
      [],
      null,
      true
    )

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load more conversations'
    )
    expect(
      screen.getByRole('button', { name: 'Load more' })
    ).toBeInTheDocument()
  })

  it('retries mark-as-read after a transient failure when the user reselects the conversation', async () => {
    const initialMarkRead = createDeferred<boolean>()
    ;(getConversationStatuses as jest.Mock).mockResolvedValue({
      statuses: [],
      nextMaxStatusId: null
    })
    ;(markConversationRead as jest.Mock).mockReturnValueOnce(
      initialMarkRead.promise
    )

    renderMessagesPage([
      conversation({ id: 'first', participantName: 'Ada', unread: true })
    ])

    await waitFor(() => {
      expect(markConversationRead).toHaveBeenCalledTimes(1)
    })

    await act(async () => {
      initialMarkRead.reject(new Error('read failed'))
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not mark conversation as read'
    )
    ;(markConversationRead as jest.Mock).mockResolvedValueOnce(true)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Ada/i }))
    })

    await waitFor(() => {
      expect(markConversationRead).toHaveBeenCalledTimes(2)
    })
  })
})
