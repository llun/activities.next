/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'

import { StatusQuote } from '@/lib/types/domain/status'
import type { Status as MastodonStatus } from '@/lib/types/mastodon/status'

import { QuoteCard } from './quote-card'

const { mockGetStatusById } = vi.hoisted(() => ({
  mockGetStatusById: vi.fn()
}))
vi.mock('@/lib/client', () => ({
  getStatusById: mockGetStatusById
}))

const CURRENT_TIME = Date.parse('2026-07-18T00:00:00.000Z')

const quote = (overrides: Partial<StatusQuote> = {}): StatusQuote => ({
  quotedStatusId: 'https://remote.example/users/bob/statuses/1',
  state: 'accepted',
  authorizationUri: null,
  ...overrides
})

const mastodonStatus = (): MastodonStatus =>
  ({
    id: 'https://remote.example/users/bob/statuses/1',
    url: 'https://remote.example/@bob/1',
    uri: 'https://remote.example/users/bob/statuses/1',
    content: '<p>the quoted content</p>',
    created_at: '2026-07-17T23:30:00.000Z',
    account: {
      acct: 'bob@remote.example',
      username: 'bob',
      display_name: 'Bob',
      avatar: 'https://remote.example/avatars/bob.png',
      url: 'https://remote.example/@bob'
    }
  }) as unknown as MastodonStatus

describe('QuoteCard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders the quoted post preview for an accepted quote', async () => {
    mockGetStatusById.mockResolvedValue(mastodonStatus())
    render(<QuoteCard quote={quote()} currentTime={CURRENT_TIME} />)

    expect(await screen.findByText('the quoted content')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('@bob@remote.example')).toBeInTheDocument()
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', 'https://remote.example/@bob/1')
  })

  it('shows an unavailable tombstone when the quoted post is not readable', async () => {
    mockGetStatusById.mockResolvedValue(null)
    render(<QuoteCard quote={quote()} currentTime={CURRENT_TIME} />)

    expect(
      await screen.findByText('This quoted post is unavailable')
    ).toBeInTheDocument()
  })

  it.each([
    { state: 'pending', text: 'Quote pending approval' },
    { state: 'rejected', text: 'This quote was declined' },
    { state: 'revoked', text: 'This quote was withdrawn' },
    { state: 'deleted', text: 'The quoted post is no longer available' }
  ] as const)(
    'renders the $state tombstone without fetching',
    async ({ state, text }) => {
      render(<QuoteCard quote={quote({ state })} currentTime={CURRENT_TIME} />)
      expect(screen.getByText(text)).toBeInTheDocument()
      await waitFor(() => expect(mockGetStatusById).not.toHaveBeenCalled())
    }
  )
})
