/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'

import { StatusLikes } from './StatusLikes'
import { useFavouritedBy } from './useFavouritedBy'

vi.mock('./useFavouritedBy', () => ({
  useFavouritedBy: vi.fn()
}))

const createMockAccount = (
  overrides?: Partial<MastodonAccount>
): MastodonAccount =>
  ({
    id: 'acc-1',
    username: 'alice',
    acct: 'alice@example.com',
    display_name: 'Alice',
    url: 'https://example.com/@alice',
    uri: 'https://example.com/users/alice',
    avatar: '',
    avatar_static: '',
    avatar_description: '',
    header: '',
    header_static: '',
    header_description: '',
    emojis: [],
    fields: [],
    locked: false,
    bot: false,
    group: false,
    discoverable: true,
    created_at: new Date().toISOString(),
    note: '',
    statuses_count: 0,
    followers_count: 0,
    following_count: 0,
    source: {
      privacy: 'public',
      sensitive: false,
      language: '',
      note: '',
      fields: []
    },
    ...overrides
  }) as MastodonAccount

describe('StatusLikes', () => {
  const mockUseFavouritedBy = vi.mocked(useFavouritedBy)

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseFavouritedBy.mockReturnValue({
      accounts: [],
      isLoading: false,
      totalCount: 0
    })
  })

  it('renders nothing when totalLikes is 0', () => {
    const { container } = render(
      <StatusLikes statusId="test-status-id" totalLikes={0} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders totalLikes count even when preview accounts are fewer', () => {
    mockUseFavouritedBy.mockReturnValue({
      accounts: [
        createMockAccount({
          id: 'acc-1',
          username: 'alice',
          display_name: 'Alice'
        })
      ],
      isLoading: false,
      totalCount: 1
    })

    render(<StatusLikes statusId="test-status-id" totalLikes={7} />)

    expect(screen.getByText('7 likes')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('See all likes')).toBeInTheDocument()
  })

  it('uses singular like when totalLikes is 1', () => {
    mockUseFavouritedBy.mockReturnValue({
      accounts: [
        createMockAccount({
          id: 'acc-1',
          username: 'bob',
          display_name: 'Bob'
        })
      ],
      isLoading: false,
      totalCount: 1
    })

    render(<StatusLikes statusId="test-status-id" totalLikes={1} />)

    expect(screen.getByText('1 like')).toBeInTheDocument()
    expect(screen.queryByText('See all likes')).not.toBeInTheDocument()
  })
})
