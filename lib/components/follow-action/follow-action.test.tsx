/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { follow, getFollowStatus, unfollow } from '@/lib/client'
import type { Relationship as MastodonRelationship } from '@/lib/types/mastodon/account/relationship'

import { FollowAction } from './follow-action'

vi.mock('@/lib/client', () => ({
  follow: vi.fn(),
  unfollow: vi.fn(),
  getFollowStatus: vi.fn()
}))

const relationship = (
  overrides: Partial<MastodonRelationship> = {}
): MastodonRelationship => ({
  id: 'target',
  following: false,
  showing_reblogs: false,
  notifying: false,
  followed_by: false,
  blocking: false,
  blocked_by: false,
  muting: false,
  muting_notifications: false,
  muting_expires_at: null,
  requested: false,
  requested_by: false,
  domain_blocking: false,
  endorsed: false,
  languages: ['en'],
  note: '',
  ...overrides
})

describe('FollowAction', () => {
  const followMock = follow as jest.Mock
  const unfollowMock = unfollow as jest.Mock
  const getFollowStatusMock = getFollowStatus as jest.Mock

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when not logged in', () => {
    const { container } = render(
      <FollowAction
        targetActorId="https://example.test/users/target"
        isLoggedIn={false}
        initialRelationship={relationship()}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('initializes as not following from initialRelationship and does not fetch on mount', () => {
    render(
      <FollowAction
        targetActorId="https://example.test/users/target"
        isLoggedIn
        initialRelationship={relationship({
          following: false,
          requested: false
        })}
      />
    )

    expect(screen.getByRole('button', { name: 'Follow' })).toBeInTheDocument()
    expect(getFollowStatusMock).not.toHaveBeenCalled()
  })

  it('initializes as requested from initialRelationship', () => {
    render(
      <FollowAction
        targetActorId="https://example.test/users/target"
        isLoggedIn
        initialRelationship={relationship({ requested: true })}
      />
    )

    expect(
      screen.getByRole('button', { name: 'Requested' })
    ).toBeInTheDocument()
    expect(getFollowStatusMock).not.toHaveBeenCalled()
  })

  it('initializes as following from initialRelationship', () => {
    render(
      <FollowAction
        targetActorId="https://example.test/users/target"
        isLoggedIn
        initialRelationship={relationship({ following: true })}
      />
    )

    expect(screen.getByRole('button', { name: 'Unfollow' })).toBeInTheDocument()
    expect(getFollowStatusMock).not.toHaveBeenCalled()
  })

  it('fetches follow status on mount when initialRelationship is undefined', async () => {
    getFollowStatusMock.mockResolvedValue('following')

    render(
      <FollowAction
        targetActorId="https://example.test/users/target"
        isLoggedIn
      />
    )

    await waitFor(() => {
      expect(getFollowStatusMock).toHaveBeenCalledWith({
        targetActorId: 'https://example.test/users/target'
      })
    })
    expect(
      await screen.findByRole('button', { name: 'Unfollow' })
    ).toBeInTheDocument()
  })

  it('follows account and updates status to requested when approval is pending', async () => {
    followMock.mockResolvedValue(true)
    getFollowStatusMock.mockResolvedValue('requested')

    render(
      <FollowAction
        targetActorId="https://example.test/users/target"
        isLoggedIn
        initialRelationship={relationship()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Follow' }))

    await waitFor(() => {
      expect(followMock).toHaveBeenCalledWith({
        targetActorId: 'https://example.test/users/target'
      })
    })
    expect(
      await screen.findByRole('button', { name: 'Requested' })
    ).toBeInTheDocument()
  })

  it('unfollows account and updates status to not_following', async () => {
    unfollowMock.mockResolvedValue(true)

    render(
      <FollowAction
        targetActorId="https://example.test/users/target"
        isLoggedIn
        initialRelationship={relationship({ following: true })}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Unfollow' }))

    await waitFor(() => {
      expect(unfollowMock).toHaveBeenCalledWith({
        targetActorId: 'https://example.test/users/target'
      })
    })
    expect(
      await screen.findByRole('button', { name: 'Follow' })
    ).toBeInTheDocument()
  })

  it('cancels pending follow request when clicking Requested', async () => {
    unfollowMock.mockResolvedValue(true)

    render(
      <FollowAction
        targetActorId="https://example.test/users/target"
        isLoggedIn
        initialRelationship={relationship({ requested: true })}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Requested' }))

    await waitFor(() => {
      expect(unfollowMock).toHaveBeenCalledWith({
        targetActorId: 'https://example.test/users/target'
      })
    })
    expect(
      await screen.findByRole('button', { name: 'Follow' })
    ).toBeInTheDocument()
  })
})
