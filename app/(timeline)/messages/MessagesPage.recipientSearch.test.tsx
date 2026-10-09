/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, screen, within } from '@testing-library/react'

import { getConversationStatuses, searchAccounts } from '@/lib/client'
import { createDeferred } from '@/lib/testing/deferred'
import { Status } from '@/lib/types/domain/status'
import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'

import {
  account,
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
    vi.useFakeTimers()
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
        vi.advanceTimersByTime(300)
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
      vi.useRealTimers()
    }
  })

  it('shows and clears not-found feedback for debounced recipient searches', async () => {
    vi.useFakeTimers()
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
        vi.advanceTimersByTime(300)
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(searchAccounts).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('alert')).toHaveTextContent('Account not found')

      fireEvent.change(recipientInput, { target: { value: 'next' } })

      expect(screen.queryByText('Account not found')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels the pending debounced recipient search when Enter searches immediately', async () => {
    vi.useFakeTimers()
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
        vi.advanceTimersByTime(300)
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(searchAccounts).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels a pending recipient search when selecting an existing conversation', async () => {
    vi.useFakeTimers()
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
        vi.advanceTimersByTime(300)
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(searchAccounts).not.toHaveBeenCalled()
      expect(screen.queryByText('Account not found')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores stale recipient search results when the query changes during an in-flight lookup', async () => {
    vi.useFakeTimers()
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
        vi.advanceTimersByTime(300)
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
        vi.advanceTimersByTime(300)
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
      vi.useRealTimers()
    }
  })
})
