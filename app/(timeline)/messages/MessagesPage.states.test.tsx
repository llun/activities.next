/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'

import {
  getConversationStatuses,
  getConversations,
  hideConversation,
  markConversationRead,
  searchAccounts
} from '@/lib/client'
import { createDeferred } from '@/lib/testing/deferred'
import { Status } from '@/lib/types/domain/status'

import {
  account,
  conversation,
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

const emptyThread = { statuses: [], nextMaxStatusId: null }

describe('MessagesPage empty, loading and failed states', () => {
  beforeEach(() => {
    resetMessagesPageMocks()
    ;(getConversationStatuses as jest.Mock).mockResolvedValue(emptyThread)
  })

  describe('with no conversations', () => {
    it('says so, and the New message action opens the composer', () => {
      renderMessagesPage([], null)

      const list = screen.getByLabelText('Conversation list')
      expect(within(list).getByText('No messages')).toBeInTheDocument()
      expect(screen.getByText('Start a conversation')).toBeInTheDocument()

      fireEvent.click(within(list).getByRole('button', { name: 'New message' }))

      expect(
        screen.getByRole('heading', { name: 'New message' })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('textbox', { name: 'Search recipients' })
      ).toBeInTheDocument()
    })

    it('lists the conversations as list items once there are some', () => {
      renderMessagesPage([
        conversation({ id: 'a', participantName: 'Ada' }),
        conversation({ id: 'b', participantName: 'Bea' })
      ])

      const list = screen.getByLabelText('Conversation list')
      expect(within(list).getAllByRole('listitem')).toHaveLength(2)
      expect(
        within(list).queryByRole('button', { name: 'New message' })
      ).not.toBeInTheDocument()
    })
  })

  it('shows a skeleton while the thread loads', async () => {
    const thread = createDeferred<typeof emptyThread>()
    ;(getConversationStatuses as jest.Mock).mockReturnValue(thread.promise)

    renderMessagesPage([conversation({ id: 'first', participantName: 'Ada' })])

    const messageThread = screen.getByLabelText('Message thread')
    expect(within(messageThread).getByRole('status')).toHaveTextContent(
      'Loading messages'
    )
    expect(
      messageThread.querySelectorAll('[data-slot="skeleton-bar"]').length
    ).toBeGreaterThan(0)

    thread.resolve(emptyThread)
    expect(await screen.findByText('No messages yet')).toBeInTheDocument()
    expect(within(messageThread).queryByRole('status')).toBeNull()
  })

  it('says there are no messages yet in a conversation with none', async () => {
    renderMessagesPage([conversation({ id: 'first', participantName: 'Ada' })])

    expect(await screen.findByText('No messages yet')).toBeInTheDocument()
    expect(screen.getByText('Write the first message below.')).toBeVisible()
  })

  it('marks an unread conversation for assistive technology as well as by sight', () => {
    renderMessagesPage(
      [
        conversation({ id: 'a', participantName: 'Ada', unread: true }),
        conversation({ id: 'b', participantName: 'Bea' })
      ],
      null
    )

    expect(
      within(screen.getByRole('button', { name: /Ada/ })).getByText('Unread')
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('button', { name: /Bea/ })).queryByText('Unread')
    ).not.toBeInTheDocument()
  })

  describe('Retry', () => {
    it('loads the thread again after it failed to load', async () => {
      ;(getConversationStatuses as jest.Mock)
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({
          statuses: [status('s1', 'Hello again')],
          nextMaxStatusId: null
        })

      renderMessagesPage([
        conversation({ id: 'first', participantName: 'Ada' })
      ])

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('Could not load messages')

      fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))

      expect(await screen.findByText('Hello again')).toBeInTheDocument()
      expect(getConversationStatuses).toHaveBeenCalledTimes(2)
      expect(getConversationStatuses).toHaveBeenLastCalledWith({
        conversationId: 'first',
        limit: 40
      })
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('asks for the same page of older messages again', async () => {
      ;(getConversationStatuses as jest.Mock)
        .mockResolvedValueOnce({
          statuses: [status('s2', 'Newer')],
          nextMaxStatusId: 'cursor-1'
        })
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({
          statuses: [status('s1', 'Older')],
          nextMaxStatusId: null
        })

      renderMessagesPage([
        conversation({ id: 'first', participantName: 'Ada' })
      ])
      await screen.findByText('Newer')

      fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('Could not load more messages')

      fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))

      expect(await screen.findByText('Older')).toBeInTheDocument()
      expect(getConversationStatuses).toHaveBeenLastCalledWith({
        conversationId: 'first',
        maxStatusId: 'cursor-1',
        limit: 40
      })
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('fetches the same page of conversations again', async () => {
      ;(getConversations as jest.Mock)
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({
          conversations: [conversation({ id: 'older', participantName: 'Bea' })]
        })

      renderMessagesPage(
        [conversation({ id: 'newest', participantName: 'Ada' })],
        'newest',
        [],
        null,
        true
      )

      fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('Could not load more conversations')
      // Shown in the conversation list itself, which is the pane on screen
      // on a phone until a conversation is opened.
      expect(screen.getByLabelText('Conversation list')).toContainElement(alert)

      fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))

      expect(await screen.findByText('Bea')).toBeInTheDocument()
      expect(getConversations).toHaveBeenCalledTimes(2)
      expect(getConversations).toHaveBeenLastCalledWith({
        limit: 21,
        maxId: 'newest'
      })
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('marks the open conversation read again', async () => {
      ;(markConversationRead as jest.Mock)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)

      renderMessagesPage([
        conversation({ id: 'first', participantName: 'Ada', unread: true })
      ])

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('Could not mark conversation as read')

      fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))

      await waitFor(() => expect(markConversationRead).toHaveBeenCalledTimes(2))
      expect(markConversationRead).toHaveBeenLastCalledWith({
        conversationId: 'first'
      })
      await waitFor(() =>
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      )
    })

    it('does not alert about a read that failed for a conversation that is no longer open', async () => {
      const failedRead = createDeferred<boolean>()
      ;(markConversationRead as jest.Mock)
        .mockReturnValueOnce(failedRead.promise)
        .mockResolvedValue(true)

      renderMessagesPage([
        conversation({ id: 'first', participantName: 'Ada', unread: true }),
        conversation({ id: 'second', participantName: 'Bea' })
      ])
      await waitFor(() => expect(markConversationRead).toHaveBeenCalledTimes(1))

      fireEvent.click(screen.getByRole('button', { name: /Bea/ }))
      failedRead.resolve(false)

      await waitFor(() =>
        expect(screen.getByText('Unread')).toBeInTheDocument()
      )
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('runs the recipient search again', async () => {
      ;(searchAccounts as jest.Mock)
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce([account('account-ada', 'Ada')])

      renderMessagesPage([], null)

      const input = screen.getByRole('textbox', { name: 'Search recipients' })
      fireEvent.change(input, { target: { value: 'ada' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('Could not search for account')

      fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))

      expect(
        await screen.findByLabelText('Recipient search results')
      ).toBeInTheDocument()
      expect(searchAccounts).toHaveBeenCalledTimes(2)
    })

    it('hides the conversation again', async () => {
      ;(hideConversation as jest.Mock)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)

      renderMessagesPage([
        conversation({ id: 'first', participantName: 'Ada' })
      ])
      await screen.findByText('No messages yet')

      fireEvent.click(screen.getByRole('button', { name: 'Hide conversation' }))
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('Could not hide conversation')

      fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))

      await waitFor(() => expect(hideConversation).toHaveBeenCalledTimes(2))
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: /Ada/ })).toBeNull()
      )
    })

    it('offers no Retry for a message that did not send, since the text is still in the form', async () => {
      const { createDirectMessage } = await import('@/lib/client')
      ;(createDirectMessage as jest.Mock).mockRejectedValue(new Error('boom'))

      renderMessagesPage([
        conversation({ id: 'first', participantName: 'Ada' })
      ])
      await screen.findByText('No messages yet')

      fireEvent.change(screen.getByRole('textbox', { name: 'Message text' }), {
        target: { value: 'Hi' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('Could not send message')
      expect(
        within(alert).queryByRole('button', { name: 'Retry' })
      ).not.toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: 'Message text' })).toHaveValue(
        'Hi'
      )
    })
  })
})
