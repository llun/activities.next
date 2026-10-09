/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'

import {
  createDirectMessage,
  getConversationStatuses,
  getConversations,
  markConversationRead
} from '@/lib/client'
import { createDeferred } from '@/lib/testing/deferred'
import { hydrateServerHtml } from '@/lib/testing/hydrateServerHtml'
import { withTimeZone } from '@/lib/testing/withTimeZone'
import { Status, StatusNote } from '@/lib/types/domain/status'

import { MessagesPage } from './MessagesPage'
import {
  conversation,
  currentActor,
  currentTime,
  renderMessagesPage,
  resetMessagesPageMocks,
  status
} from './MessagesPage.testUtils'

vi.mock('@/lib/client', () => ({
  createDirectMessage: vi.fn(),
  getConversationStatuses: vi.fn(),
  getConversations: vi.fn(),
  hideConversation: vi.fn(),
  markConversationRead: vi.fn(),
  searchAccounts: vi.fn()
}))

vi.mock('@/lib/components/posts/posts', () => ({
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

describe('MessagesPage', () => {
  beforeEach(() => {
    resetMessagesPageMocks()
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
      ...(htmlConversation.lastStatus as StatusNote),
      text: '<p>Hello <strong>Ada</strong> &amp; Bea</p><p>See &lt;you&gt;</p>'
    }

    renderMessagesPage([htmlConversation], null)

    const conversationButton = screen.getByRole('button', { name: /Ada/i })

    expect(conversationButton).toHaveTextContent('Hello Ada & Bea See <you>')
    expect(conversationButton).not.toHaveTextContent('<p>')
    expect(conversationButton).not.toHaveTextContent('</strong>')
    expect(conversationButton).not.toHaveTextContent('&amp;')
  })

  it("hydrates the server's UTC conversation time without a mismatch, then shows the reader's own", async () => {
    ;(getConversationStatuses as jest.Mock).mockResolvedValue({
      statuses: [],
      nextMaxStatusId: null
    })
    // 02:30 UTC on 17 May is 22:30 on 16 May in New York (EDT, UTC-4).
    const lateConversation = {
      ...conversation({ id: 'first', participantName: 'Ada' }),
      lastStatusCreatedAt: Date.parse('2026-05-17T02:30:00.000Z')
    }
    const element = (
      <MessagesPage
        host="example.com"
        conversations={[lateConversation]}
        initialConversationId={null}
        initialStatuses={[]}
        initialNextMaxStatusId={null}
        currentActor={currentActor}
      />
    )

    await withTimeZone('America/New_York', async () => {
      const { serverHtml, container, onRecoverableError, unmount } =
        await hydrateServerHtml(element)

      try {
        expect(serverHtml).toContain('May 17, 2:30 AM')
        expect(onRecoverableError).not.toHaveBeenCalled()
        // In the reader's own locale, which the suite does not pin.
        expect(
          within(container).getByRole('button', { name: /Ada/i }).textContent
        ).toContain(
          new Intl.DateTimeFormat(undefined, {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            timeZone: 'America/New_York'
          }).format(lateConversation.lastStatusCreatedAt)
        )
      } finally {
        unmount()
      }
    })
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

  describe('stale load-more requests after switching conversations', () => {
    type ThreadPage = { statuses: Status[]; nextMaxStatusId: string | null }

    // Ada's Load more is left in flight, the reader switches to Bea and back,
    // and a second Load more on the reloaded Ada thread is the active one.
    const startStaleAndActiveLoadMore = async () => {
      const initialThread = createDeferred<ThreadPage>()
      const staleOlderThread = createDeferred<ThreadPage>()
      const secondThread = createDeferred<ThreadPage>()
      const reloadedThread = createDeferred<ThreadPage>()
      const activeOlderThread = createDeferred<ThreadPage>()
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

      return { thread, staleOlderThread, activeOlderThread }
    }

    const resolveBothOlderThreads = async ({
      staleOlderThread,
      activeOlderThread
    }: Awaited<ReturnType<typeof startStaleAndActiveLoadMore>>) => {
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
    }

    it('drops the statuses a stale load-more returns', async () => {
      const pending = await startStaleAndActiveLoadMore()

      await resolveBothOlderThreads(pending)

      expect(await screen.findByText('Active older')).toBeInTheDocument()
      await waitFor(() => {
        expect(screen.queryByText('Stale older')).not.toBeInTheDocument()
      })
    })

    it('keeps the scroll anchor for the active load-more when a stale one resolves too', async () => {
      const pending = await startStaleAndActiveLoadMore()

      await resolveBothOlderThreads(pending)

      expect(await screen.findByText('Active older')).toBeInTheDocument()
      await waitFor(() => {
        expect(pending.thread.scrollTop).toBe(540)
      })
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

  it('renders the recipient input and Send button without a Search recipients button', () => {
    renderMessagesPage([], null)

    expect(
      screen.getByRole('textbox', { name: 'Search recipients' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Search recipients' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('textbox', { name: 'Message text' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Send message' })
    ).toHaveTextContent('Send')
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
    const fileStatus: StatusNote = {
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
    const fitnessStatus: StatusNote = {
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

  it('gives a recipient the fitness card without a download link', async () => {
    // `fitness.url` serves the ORIGINAL upload, which still holds the ends a
    // privacy location trims off the route map and route data, and
    // `GET /api/v1/fitness-files/:id` is owner-only — so a recipient's copy of
    // the card must not be an anchor. The card itself stays: name, type and
    // metrics are the message's content.
    const receivedFitnessStatus: StatusNote = {
      ...status('fit-2', ''),
      actorId: 'https://example.com/users/ada',
      fitness: {
        id: 'fitness-2',
        fileName: 'ada-run.gpx',
        fileType: 'gpx',
        mimeType: 'application/gpx+xml',
        bytes: 2048,
        url: 'https://example.com/files/ada-run.gpx',
        totalDistanceMeters: 12000,
        totalDurationSeconds: 3600
      }
    }
    ;(getConversationStatuses as jest.Mock).mockResolvedValue({
      statuses: [receivedFitnessStatus],
      nextMaxStatusId: null
    })

    renderMessagesPage([conversation({ id: 'first', participantName: 'Ada' })])

    expect(await screen.findByText('ada-run.gpx')).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /ada-run\.gpx/ })
    ).not.toBeInTheDocument()
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
