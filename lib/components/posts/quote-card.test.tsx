/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'

import { StatusQuote } from '@/lib/types/domain/status'
import type { Status as MastodonStatus } from '@/lib/types/mastodon/status'

import { QuoteCard } from './quote-card'

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch,
    onClick,
    ...rest
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string
    prefetch?: boolean | 'auto' | null
    children: ReactNode
  }) => (
    <a
      href={href}
      data-prefetch={String(prefetch)}
      onClick={(e) => {
        e.preventDefault()
        onClick?.(e)
      }}
      {...rest}
    >
      {children}
    </a>
  )
}))

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

  it('renders the quoted post preview for an accepted quote linking to service url', async () => {
    mockGetStatusById.mockResolvedValue(mastodonStatus())
    render(<QuoteCard quote={quote()} currentTime={CURRENT_TIME} />)

    expect(await screen.findByText('the quoted content')).toBeInTheDocument()
    const name = screen.getByText('Bob')
    expect(name).toBeInTheDocument()
    expect(name).toHaveClass('shrink-0', 'max-w-full', 'truncate')

    const handle = screen.getByText('@bob@remote.example')
    expect(handle).toBeInTheDocument()
    expect(handle).toHaveClass('min-w-0', 'flex-1', 'truncate')

    const link = screen.getByRole('link')
    expect(link).toHaveAttribute(
      'href',
      `/@bob@remote.example/${encodeURIComponent('https://remote.example/users/bob/statuses/1')}`
    )
    expect(link).toHaveAttribute('data-prefetch', 'false')
    expect(link).toHaveClass('overflow-hidden')
  })

  it('links to service url with publicId when status id is a publicId', async () => {
    const publicId = '0195655a-4632-72dc-bb1e-a4b59367ca22'
    mockGetStatusById.mockResolvedValue({
      ...mastodonStatus(),
      id: publicId
    })
    render(<QuoteCard quote={quote()} currentTime={CURRENT_TIME} />)

    const link = await screen.findByRole('link')
    expect(link).toHaveAttribute('href', `/@bob@remote.example/${publicId}`)
    expect(link).toHaveAttribute('data-prefetch', 'false')
  })

  it('shows an unavailable tombstone when the quoted post is not readable', async () => {
    mockGetStatusById.mockResolvedValue(null)
    render(<QuoteCard quote={quote()} currentTime={CURRENT_TIME} />)

    expect(
      await screen.findByText('This quoted post is unavailable')
    ).toBeInTheDocument()
  })

  it('falls back to the unavailable tombstone when the fetch rejects', async () => {
    mockGetStatusById.mockRejectedValue(new Error('network down'))
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

  it('stops click event propagation so parent handlers are not triggered', async () => {
    mockGetStatusById.mockResolvedValue(mastodonStatus())
    const parentClick = vi.fn()

    render(
      <div onClick={parentClick}>
        <QuoteCard quote={quote()} currentTime={CURRENT_TIME} />
      </div>
    )

    const link = await screen.findByRole('link')
    fireEvent.click(link)

    expect(parentClick).not.toHaveBeenCalled()
  })
})
