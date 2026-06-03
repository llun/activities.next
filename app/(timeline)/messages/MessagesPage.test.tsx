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

  it('converts HTML conversation previews to readable plain text', async () => {
    ;(getConversationStatuses as jest.Mock).mockResolvedValue({
      statuses: [],
      nextMaxStatusId: null
    })

    const htmlConversation = conversation({
      id: 'first',
      participantName: 'Ada'
    })
    htmlConversation.lastStatus = {
      ...htmlConversation.lastStatus,
      text: '<p>Hello <strong>Ada</strong> &amp; Bea</p><p>See &lt;you&gt;</p>'
    }

    renderMessagesPage([htmlConversation], null)

    const conversationButton = screen.getByRole('button', { name: /Ada/i })

    expect(conversationButton).toHaveTextContent('Hello Ada & Bea See <you>')
    expect(conversationButton).not.toHaveTextContent('<p>')
    expect(conversationButton).not.toHaveTextContent('</strong>')
    expect(conversationButton).not.toHaveTextContent('&amp;')
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
    expect(searchAccounts).toHaveBeenCalledWith(
      expect.objectContaining({
        q: 'ad',
        resolve: true,
        limit: 5,
        signal: expect.any(AbortSignal)
      })
    )

    fireEvent.click(within(resultsList).getByText('Adam'))

    expect(
      screen.queryByLabelText('Recipient search results')
    ).not.toBeInTheDocument()
    expect(screen.getByText('Adam')).toBeInTheDocument()
  })

  it('searches recipients as the query changes without a search button', async () => {
    jest.useFakeTimers()
    try {
      ;(getConversationStatuses as jest.Mock).mockResolvedValue({
        statuses: [],
        nextMaxStatusId: null
      })
      ;(searchAccounts as jest.Mock).mockResolvedValue([
        account('account-ada', 'Ada')
      ])

      renderMessagesPage([], null)

      expect(
        screen.queryByRole('button', { name: 'Search recipients' })
      ).not.toBeInTheDocument()

      fireEvent.change(
        screen.getByRole('textbox', { name: 'Search recipients' }),
        { target: { value: 'ada' } }
      )

      await act(async () => {
        jest.advanceTimersByTime(300)
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(searchAccounts).toHaveBeenCalledWith(
        expect.objectContaining({
          q: 'ada',
          resolve: true,
          limit: 5,
          signal: expect.any(AbortSignal)
        })
      )
      expect(
        screen.getByLabelText('Recipient search results')
      ).toBeInTheDocument()
      expect(screen.getByText('Ada')).toBeInTheDocument()

      fireEvent.change(
        screen.getByRole('textbox', { name: 'Search recipients' }),
        { target: { value: 'bob' } }
      )

      await act(async () => {
        await Promise.resolve()
      })

      expect(screen.queryByText('Ada')).not.toBeInTheDocument()
    } finally {
      jest.useRealTimers()
    }
  })

  it('shows and clears not-found feedback for debounced recipient searches', async () => {
    jest.useFakeTimers()
    try {
      ;(getConversationStatuses as jest.Mock).mockResolvedValue({
        statuses: [],
        nextMaxStatusId: null
      })
      ;(searchAccounts as jest.Mock).mockResolvedValue([])

      renderMessagesPage([], null)

      const recipientInput = screen.getByRole('textbox', {
        name: 'Search recipients'
      })

      fireEvent.change(recipientInput, { target: { value: 'missing' } })

      await act(async () => {
        jest.advanceTimersByTime(300)
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(searchAccounts).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('alert')).toHaveTextContent('Account not found')

      fireEvent.change(recipientInput, { target: { value: 'next' } })

      expect(screen.queryByText('Account not found')).not.toBeInTheDocument()
    } finally {
      jest.useRealTimers()
    }
  })

  it('cancels the pending debounced recipient search when Enter searches immediately', async () => {
    jest.useFakeTimers()
    try {
      ;(getConversationStatuses as jest.Mock).mockResolvedValue({
        statuses: [],
        nextMaxStatusId: null
      })
      ;(searchAccounts as jest.Mock).mockResolvedValue([
        account('account-ada', 'Ada')
      ])

      renderMessagesPage([], null)

      const recipientInput = screen.getByRole('textbox', {
        name: 'Search recipients'
      })
      fireEvent.change(recipientInput, { target: { value: 'ada' } })
      fireEvent.keyDown(recipientInput, { key: 'Enter' })

      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(searchAccounts).toHaveBeenCalledTimes(1)
      expect(searchAccounts).toHaveBeenCalledWith(
        expect.objectContaining({
          q: 'ada',
          resolve: true,
          limit: 5,
          signal: expect.any(AbortSignal)
        })
      )

      await act(async () => {
        jest.advanceTimersByTime(300)
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(searchAccounts).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })

  it('cancels a pending recipient search when selecting an existing conversation', async () => {
    jest.useFakeTimers()
    try {
      ;(getConversationStatuses as jest.Mock).mockResolvedValue({
        statuses: [],
        nextMaxStatusId: null
      })
      ;(searchAccounts as jest.Mock).mockResolvedValue([])

      renderMessagesPage(
        [conversation({ id: 'first', participantName: 'Ada' })],
        null
      )

      const recipientInput = screen.getByRole('textbox', {
        name: 'Search recipients'
      })
      fireEvent.change(recipientInput, { target: { value: 'missing' } })
      fireEvent.click(screen.getByRole('button', { name: /Ada/ }))

      await act(async () => {
        jest.advanceTimersByTime(300)
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(searchAccounts).not.toHaveBeenCalled()
      expect(screen.queryByText('Account not found')).not.toBeInTheDocument()
    } finally {
      jest.useRealTimers()
    }
  })

  it('ignores stale recipient search results when the query changes during an in-flight lookup', async () => {
    jest.useFakeTimers()
    try {
      ;(getConversationStatuses as jest.Mock).mockResolvedValue({
        statuses: [],
        nextMaxStatusId: null
      })
      const adaSearch = createDeferred<MastodonAccount[]>()
      const bobSearch = createDeferred<MastodonAccount[]>()
      ;(searchAccounts as jest.Mock)
        .mockReturnValueOnce(adaSearch.promise)
        .mockReturnValueOnce(bobSearch.promise)

      renderMessagesPage([], null)

      const recipientInput = screen.getByRole('textbox', {
        name: 'Search recipients'
      })
      fireEvent.change(recipientInput, { target: { value: 'ada' } })

      await act(async () => {
        jest.advanceTimersByTime(300)
        await Promise.resolve()
      })

      expect(searchAccounts).toHaveBeenCalledWith(
        expect.objectContaining({
          q: 'ada',
          resolve: true,
          limit: 5,
          signal: expect.any(AbortSignal)
        })
      )
      const firstSearchSignal = (searchAccounts as jest.Mock).mock.calls[0][0]
        .signal as AbortSignal

      fireEvent.change(recipientInput, { target: { value: 'bob' } })

      expect(firstSearchSignal.aborted).toBe(true)

      await act(async () => {
        adaSearch.resolve([account('account-ada', 'Ada')])
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(screen.queryByText('Ada')).not.toBeInTheDocument()

      await act(async () => {
        jest.advanceTimersByTime(300)
        await Promise.resolve()
      })

      expect(searchAccounts).toHaveBeenLastCalledWith(
        expect.objectContaining({
          q: 'bob',
          resolve: true,
          limit: 5,
          signal: expect.any(AbortSignal)
        })
      )

      await act(async () => {
        bobSearch.resolve([account('account-bob', 'Bob')])
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(screen.getByText('Bob')).toBeInTheDocument()
      expect(screen.queryByText('Ada')).not.toBeInTheDocument()
    } finally {
      jest.useRealTimers()
    }
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

  it('fills the unified content column with aligned composer controls', () => {
    const { container } = renderMessagesPage([], null)

    // The conversation pane stretches to fill the shared content column
    // (max-w-content on the timeline wrapper) rather than opting into its own
    // width, so Messages lines up with every other desktop tab.
    expect(container.firstElementChild).toHaveClass('flex-1')

    const directMessages = screen.getByLabelText('Direct messages')
    expect(directMessages).toHaveClass('flex-1')
    expect(directMessages.className).not.toContain('100svh')
    expect(directMessages.className).toContain(
      '2xl:grid-cols-[380px_minmax(0,1fr)]'
    )

    const recipientInput = screen.getByRole('textbox', {
      name: 'Search recipients'
    })
    expect(recipientInput.parentElement).toHaveClass('relative')
    expect(
      screen.queryByRole('button', { name: 'Search recipients' })
    ).not.toBeInTheDocument()

    const messageInput = screen.getByRole('textbox', { name: 'Message text' })
    expect(messageInput).toHaveClass('flex-1')
    const sendButton = screen.getByRole('button', { name: 'Send message' })
    expect(sendButton).toHaveTextContent('Send')
    // The composer is an inline row: the textarea and Send button sit side by
    // side, bottom-aligned, rather than the button stacked below.
    expect(sendButton.parentElement).toHaveClass('items-end')
  })

  it('renders sent and received messages as aligned chat bubbles', async () => {
    const receivedStatus: Status = {
      ...status('them-1', 'Theirs'),
      actorId: 'https://example.com/users/ada',
      actor: null,
      isLocalActor: false
    }
    ;(getConversationStatuses as jest.Mock).mockResolvedValue({
      statuses: [status('me-1', 'Mine'), receivedStatus],
      nextMaxStatusId: null
    })

    renderMessagesPage([conversation({ id: 'first', participantName: 'Ada' })])

    const mine = await screen.findByText('Mine')
    const theirs = await screen.findByText('Theirs')

    // Own messages: orange (primary) bubble, right-aligned.
    expect(mine.closest('.bg-primary')).not.toBeNull()
    expect(mine.closest('.justify-end')).not.toBeNull()
    // Received messages: muted bubble, left-aligned.
    expect(theirs.closest('.bg-muted')).not.toBeNull()
    expect(theirs.closest('.justify-start')).not.toBeNull()
  })

  it('flags own (orange) bubbles with on-primary so inline links flip to white', async () => {
    const receivedStatus: Status = {
      ...status('them-1', 'Theirs'),
      actorId: 'https://example.com/users/ada',
      actor: null,
      isLocalActor: false
    }
    ;(getConversationStatuses as jest.Mock).mockResolvedValue({
      statuses: [status('me-1', 'Mine'), receivedStatus],
      nextMaxStatusId: null
    })

    renderMessagesPage([conversation({ id: 'first', participantName: 'Ada' })])

    const mine = await screen.findByText('Mine')
    const theirs = await screen.findByText('Theirs')

    // The own bubble's text container carries `on-primary`, which the
    // `.markdown-content.on-primary a` rule in globals.css uses to render links
    // white instead of the default blue that fails contrast on orange.
    expect(mine.closest('.markdown-content')).toHaveClass('on-primary')
    // Received bubbles keep the default link treatment (no on-primary).
    expect(theirs.closest('.markdown-content')).not.toHaveClass('on-primary')
  })

  it('renders message bubble text as rich DOM rather than escaped HTML', async () => {
    ;(getConversationStatuses as jest.Mock).mockResolvedValue({
      statuses: [status('rich-1', '**bold**')],
      nextMaxStatusId: null
    })

    renderMessagesPage([conversation({ id: 'first', participantName: 'Ada' })])

    // The markdown is converted to a real <strong> element; if the processed
    // markup were escaped (e.g. rendered as a raw string), the text node would
    // read "**bold**" and never resolve to a STRONG tag.
    const bold = await screen.findByText('bold')
    expect(bold.tagName).toBe('STRONG')
  })

  it('surfaces non-visual attachments as a download link instead of an empty bubble', async () => {
    const fileStatus: Status = {
      ...status('file-1', ''),
      attachments: [
        {
          id: 'att-1',
          actorId: currentActor.id,
          statusId: 'file-1',
          type: 'Document',
          mediaType: 'application/pdf',
          url: 'https://example.com/files/plan.pdf',
          name: 'plan.pdf',
          createdAt: currentTime,
          updatedAt: currentTime
        }
      ]
    }
    ;(getConversationStatuses as jest.Mock).mockResolvedValue({
      statuses: [fileStatus],
      nextMaxStatusId: null
    })

    renderMessagesPage([conversation({ id: 'first', participantName: 'Ada' })])

    const link = await screen.findByRole('link', { name: /plan\.pdf/ })
    expect(link).toHaveAttribute('href', 'https://example.com/files/plan.pdf')
  })

  it('renders a fitness file as a card with its filename and metrics', async () => {
    const fitnessStatus: Status = {
      ...status('fit-1', ''),
      fitness: {
        id: 'fitness-1',
        fileName: 'morning-run.gpx',
        fileType: 'gpx',
        mimeType: 'application/gpx+xml',
        bytes: 2048,
        url: 'https://example.com/files/morning-run.gpx',
        totalDistanceMeters: 12000,
        totalDurationSeconds: 3600
      }
    }
    ;(getConversationStatuses as jest.Mock).mockResolvedValue({
      statuses: [fitnessStatus],
      nextMaxStatusId: null
    })

    renderMessagesPage([conversation({ id: 'first', participantName: 'Ada' })])

    const link = await screen.findByRole('link', { name: /morning-run\.gpx/ })
    expect(link).toHaveAttribute(
      'href',
      'https://example.com/files/morning-run.gpx'
    )
    expect(link).toHaveTextContent('GPX')
    expect(link).toHaveTextContent(/km/)
  })

  it('shows "No messages yet" for a selected conversation with no messages', async () => {
    ;(getConversationStatuses as jest.Mock).mockResolvedValue({
      statuses: [],
      nextMaxStatusId: null
    })

    renderMessagesPage([conversation({ id: 'first', participantName: 'Ada' })])

    expect(await screen.findByText('No messages yet')).toBeInTheDocument()
  })

  it('prefixes the conversation preview with "You:" for your own last message', () => {
    ;(getConversationStatuses as jest.Mock).mockResolvedValue({
      statuses: [],
      nextMaxStatusId: null
    })

    renderMessagesPage(
      [conversation({ id: 'first', participantName: 'Ada' })],
      null
    )

    expect(screen.getByRole('button', { name: /Ada/i })).toHaveTextContent(
      'You: Last Ada'
    )
  })

  it('shows an error when the conversation thread fails to load', async () => {
    ;(getConversationStatuses as jest.Mock).mockRejectedValue(new Error('boom'))

    renderMessagesPage([conversation({ id: 'first', participantName: 'Ada' })])

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load messages'
    )
  })

  it('shows an error when loading older messages fails', async () => {
    ;(getConversationStatuses as jest.Mock)
      .mockResolvedValueOnce({
        statuses: [status('first-status', 'First conversation status')],
        nextMaxStatusId: 'older-cursor'
      })
      .mockRejectedValueOnce(new Error('boom'))

    renderMessagesPage([conversation({ id: 'first', participantName: 'Ada' })])

    expect(
      await screen.findByText('First conversation status')
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load more messages'
    )
    ;(getConversationStatuses as jest.Mock).mockResolvedValueOnce({
      statuses: [status('older-status', 'Older conversation status')],
      nextMaxStatusId: null
    })

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    expect(
      await screen.findByText('Older conversation status')
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  it('uses a single-pane mobile layout when a conversation is selected', async () => {
    const initialThread = createDeferred<{
      statuses: Status[]
      nextMaxStatusId: string | null
    }>()
    ;(getConversationStatuses as jest.Mock).mockReturnValue(
      initialThread.promise
    )

    renderMessagesPage([conversation({ id: 'first', participantName: 'Ada' })])

    const conversationList = screen.getByLabelText('Conversation list')
    const conversationThread = screen.getByLabelText('Conversation thread')

    expect(conversationList).toHaveClass('max-md:hidden')
    expect(conversationThread).not.toHaveClass('max-md:hidden')
    expect(conversationList.firstElementChild).toHaveClass('md:overflow-y-auto')
    expect(conversationList.firstElementChild).not.toHaveClass(
      'overflow-y-auto'
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Back to conversations' })
    )

    expect(conversationList).not.toHaveClass('max-md:hidden')
    expect(conversationThread).toHaveClass('max-md:hidden')

    await act(async () => {
      initialThread.resolve({
        statuses: [],
        nextMaxStatusId: null
      })
    })
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
