/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { acceptFollowRequest, rejectFollowRequest } from '@/lib/client'
import type { Mastodon } from '@/lib/types/activitypub'

import { FollowRequestNotification } from './FollowRequestNotification'

vi.mock('@/lib/client', () => ({
  acceptFollowRequest: vi.fn(),
  rejectFollowRequest: vi.fn()
}))

const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh, push: vi.fn() })
}))

const account: Mastodon.Account = {
  id: 'https://llun.social/users/ride',
  username: 'ride',
  acct: 'ride@llun.social',
  url: 'https://llun.social/@ride',
  display_name: 'Ride',
  note: '',
  avatar: '',
  avatar_static: '',
  header: '',
  header_static: '',
  locked: false,
  source: {
    note: '',
    fields: [],
    privacy: 'public',
    sensitive: false,
    language: 'en',
    follow_requests_count: 0
  },
  fields: [],
  emojis: [],
  bot: false,
  group: false,
  discoverable: true,
  created_at: '2026-01-01T00:00:00.000Z',
  last_status_at: '2026-05-10',
  statuses_count: 1,
  followers_count: 0,
  following_count: 0
}

describe('FollowRequestNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(acceptFollowRequest as jest.Mock).mockResolvedValue(true)
    ;(rejectFollowRequest as jest.Mock).mockResolvedValue(true)
  })

  it('shows Approve and Reject actions for a pending request', () => {
    render(<FollowRequestNotification account={account} />)

    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument()
  })

  it('shows Approve and Reject actions when initialStatus is pending', () => {
    render(
      <FollowRequestNotification account={account} initialStatus="pending" />
    )

    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument()
  })

  it('shows an approved label and no actions when the request was already accepted', () => {
    render(
      <FollowRequestNotification account={account} initialStatus="accepted" />
    )

    expect(screen.getByText('Approved')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Approve' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Reject' })
    ).not.toBeInTheDocument()
  })

  it('shows a rejected label and no actions when the request was already rejected', () => {
    render(
      <FollowRequestNotification account={account} initialStatus="rejected" />
    )

    expect(screen.getByText('Rejected')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Approve' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Reject' })
    ).not.toBeInTheDocument()
  })

  it('shows a resolved label and no actions when the request is no longer pending', () => {
    render(
      <FollowRequestNotification account={account} initialStatus="resolved" />
    )

    expect(screen.getByText('No longer pending')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Approve' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Reject' })
    ).not.toBeInTheDocument()
  })

  it('approves a pending request and swaps the actions for an approved label', async () => {
    render(<FollowRequestNotification account={account} />)

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() =>
      expect(acceptFollowRequest).toHaveBeenCalledWith({ id: account.url })
    )
    expect(await screen.findByText('Approved')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Approve' })
    ).not.toBeInTheDocument()
    expect(mockRefresh).toHaveBeenCalled()
  })

  it('rejects a pending request and swaps the actions for a rejected label', async () => {
    render(<FollowRequestNotification account={account} />)

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))

    await waitFor(() =>
      expect(rejectFollowRequest).toHaveBeenCalledWith({ id: account.url })
    )
    expect(await screen.findByText('Rejected')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Reject' })
    ).not.toBeInTheDocument()
  })

  it('rejects a same-tick re-click before the disabled state applies', async () => {
    // The first request never resolves, so the action stays in flight.
    ;(acceptFollowRequest as jest.Mock).mockReturnValue(new Promise(() => {}))
    render(<FollowRequestNotification account={account} />)
    const approve = screen.getByRole('button', { name: 'Approve' })

    // Both clicks are dispatched in one batch, before React flushes the
    // disabled={isLoading} state — so only the synchronous pendingRef lock can
    // stop the second click from starting a concurrent request. (Without the
    // lock, acceptFollowRequest would be called twice.)
    await act(async () => {
      approve.click()
      approve.click()
    })

    expect(acceptFollowRequest).toHaveBeenCalledTimes(1)
  })

  it('disables both actions once one is in flight', async () => {
    ;(acceptFollowRequest as jest.Mock).mockReturnValue(new Promise(() => {}))
    render(<FollowRequestNotification account={account} />)

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()
    )
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled()
  })

  it('keeps the actions and shows an inline error when the request fails', async () => {
    ;(acceptFollowRequest as jest.Mock).mockResolvedValue(false)
    render(<FollowRequestNotification account={account} />)

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to accept follow request. Please try again.'
    )
    // A failed request must leave the row actionable (no optimistic state).
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(screen.queryByText('Approved')).not.toBeInTheDocument()
  })
})
