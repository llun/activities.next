/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, screen, waitFor } from '@testing-library/react'

import { getConversationStatuses, getConversations } from '@/lib/client'
import { Status } from '@/lib/types/domain/status'

import {
  conversation,
  renderMessagesPage,
  resetMessagesPageMocks
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
})
