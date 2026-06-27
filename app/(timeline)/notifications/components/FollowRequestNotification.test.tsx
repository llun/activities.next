/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import type { Mastodon } from '@/lib/types/activitypub'

import { FollowRequestNotification } from './FollowRequestNotification'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() })
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
})
