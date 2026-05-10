/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { Mastodon } from '@/lib/types/activitypub'
import { StatusNote, StatusType } from '@/lib/types/domain/status'

import { NotificationItem } from './NotificationItem'

const currentTime = new Date('2026-05-10T09:19:26.175Z').getTime()

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

const status: StatusNote = {
  id: 'https://llun.social/users/ride/statuses/activity-1',
  actorId: 'https://llun.social/users/ride',
  actor: {
    id: 'https://llun.social/users/ride',
    username: 'ride',
    domain: 'llun.social',
    name: 'Ride',
    followersUrl: 'https://llun.social/users/ride/followers',
    inboxUrl: 'https://llun.social/users/ride/inbox',
    sharedInboxUrl: 'https://llun.social/inbox',
    followingCount: 0,
    followersCount: 0,
    statusCount: 1,
    lastStatusAt: null,
    createdAt: currentTime
  },
  to: [],
  cc: [],
  edits: [],
  isLocalActor: true,
  createdAt: currentTime,
  updatedAt: currentTime,
  type: StatusType.enum.Note,
  url: 'https://llun.social/@ride/activity-1',
  text: 'Morning Ride\n20.6 km in 53:09 https://www.strava.com/activities/123',
  summary: null,
  reply: '',
  replies: [],
  actorAnnounceStatusId: null,
  isActorLiked: false,
  totalLikes: 0,
  totalShares: 0,
  attachments: [],
  tags: []
}

describe('NotificationItem', () => {
  it('renders activity import notifications with linked activity content', () => {
    const { container } = render(
      <NotificationItem
        notification={{
          id: 'notification-1',
          actorId: account.id,
          type: 'activity_import',
          sourceActorId: account.id,
          statusId: status.id,
          isRead: true,
          createdAt: currentTime,
          updatedAt: currentTime,
          account,
          status
        }}
        currentActorId={account.id}
        host="llun.social"
        isRead={true}
        observeElement={jest.fn()}
      />
    )

    expect(
      screen.getByText(/Your Strava fitness activity was imported/)
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View activity' })).toHaveAttribute(
      'href',
      expect.stringContaining('/@ride@llun.social/')
    )
    expect(screen.getByText(/Morning Ride/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /strava.com/ })).toHaveAttribute(
      'href',
      'https://www.strava.com/activities/123'
    )
    container.querySelectorAll('a').forEach((link) => {
      expect(link.querySelector('a')).toBeNull()
    })
  })

  it('renders grouped activity import notifications as multiple imports', () => {
    render(
      <NotificationItem
        notification={{
          id: 'notification-1',
          actorId: account.id,
          type: 'activity_import',
          sourceActorId: account.id,
          statusId: status.id,
          isRead: true,
          createdAt: currentTime,
          updatedAt: currentTime,
          account,
          status,
          groupedCount: 2,
          groupedIds: ['notification-1', 'notification-2']
        }}
        currentActorId={account.id}
        host="llun.social"
        isRead={true}
        observeElement={jest.fn()}
      />
    )

    expect(
      screen.getByText(/Your Strava fitness activities were imported/)
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'View latest activity' })
    ).toHaveAttribute('href', expect.stringContaining('/@ride@llun.social/'))
  })

  it('renders reblog notifications instead of an empty card', () => {
    render(
      <NotificationItem
        notification={{
          id: 'notification-2',
          actorId: 'https://llun.social/users/llun',
          type: 'reblog',
          sourceActorId: account.id,
          statusId: status.id,
          isRead: true,
          createdAt: currentTime,
          updatedAt: currentTime,
          account,
          status
        }}
        currentActorId="https://llun.social/users/llun"
        host="llun.social"
        isRead={true}
        observeElement={jest.fn()}
      />
    )

    expect(screen.getByText(/reblogged your/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ride' })).toHaveAttribute(
      'href',
      '/@ride@llun.social'
    )
    expect(screen.getByRole('link', { name: 'post' })).toHaveAttribute(
      'href',
      expect.stringContaining('/@ride@llun.social/')
    )
    expect(screen.getByText(/Morning Ride/)).toBeInTheDocument()
  })

  it('renders stale status-backed notifications so they can be marked read', () => {
    render(
      <NotificationItem
        notification={{
          id: 'notification-3',
          actorId: account.id,
          type: 'activity_import',
          sourceActorId: account.id,
          statusId: status.id,
          isRead: true,
          createdAt: currentTime,
          updatedAt: currentTime,
          account,
          status: null
        }}
        currentActorId={account.id}
        host="llun.social"
        isRead={true}
        observeElement={jest.fn()}
      />
    )

    expect(
      screen.getByText('This imported activity is no longer available.')
    ).toBeInTheDocument()
  })
})
