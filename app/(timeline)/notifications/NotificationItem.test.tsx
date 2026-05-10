/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { type ComponentProps } from 'react'

import { Mastodon } from '@/lib/types/activitypub'
import { StatusNote, StatusType } from '@/lib/types/domain/status'

import { NotificationItem } from './NotificationItem'

const currentTime = new Date('2026-05-10T09:19:26.175Z').getTime()
type NotificationItemNotification = ComponentProps<
  typeof NotificationItem
>['notification']

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

const renderNotificationItem = (notification: NotificationItemNotification) => {
  return render(
    <NotificationItem
      notification={notification}
      currentActorId={notification.actorId}
      host="llun.social"
      isRead={true}
      observeElement={jest.fn()}
    />
  )
}

describe('NotificationItem', () => {
  it('renders activity import notifications with linked activity content', () => {
    const { container } = renderNotificationItem({
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
    })

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
    renderNotificationItem({
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
    })

    expect(
      screen.getByText(/Your Strava fitness activities were imported/)
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'View latest activity' })
    ).toHaveAttribute('href', expect.stringContaining('/@ride@llun.social/'))
  })

  it('renders reblog notifications instead of an empty card', () => {
    renderNotificationItem({
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
    })

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

  it('renders grouped reblog notifications without grouped account data', () => {
    renderNotificationItem({
      id: 'notification-2',
      actorId: 'https://llun.social/users/llun',
      type: 'reblog',
      sourceActorId: account.id,
      statusId: status.id,
      isRead: true,
      createdAt: currentTime,
      updatedAt: currentTime,
      account,
      status,
      groupedCount: 3
    })

    expect(screen.getByText(/and 2 others reblogged your/)).toBeInTheDocument()
  })

  it('renders stale status-backed notifications so they can be marked read', () => {
    renderNotificationItem({
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
    })

    expect(
      screen.getByText('This imported activity is no longer available.')
    ).toBeInTheDocument()
  })

  it.each(['like', 'reply'] as const)(
    'renders unavailable notification text for %s notifications with missing accounts',
    (type) => {
      renderNotificationItem({
        id: `notification-${type}`,
        actorId: account.id,
        type,
        sourceActorId: account.id,
        statusId: status.id,
        isRead: true,
        createdAt: currentTime,
        updatedAt: currentTime,
        account: null,
        status
      })

      expect(
        screen.getByText('This notification is no longer available.')
      ).toBeInTheDocument()
    }
  )

  it.each(['like', 'reply'] as const)(
    'renders unavailable post text for %s notifications with missing statuses',
    (type) => {
      renderNotificationItem({
        id: `notification-${type}`,
        actorId: account.id,
        type,
        sourceActorId: account.id,
        statusId: status.id,
        isRead: true,
        createdAt: currentTime,
        updatedAt: currentTime,
        account,
        status: null
      })

      expect(
        screen.getByText('This post is no longer available.')
      ).toBeInTheDocument()
    }
  )

  it('renders unavailable post text for reblog notifications with missing statuses', () => {
    renderNotificationItem({
      id: 'notification-reblog',
      actorId: account.id,
      type: 'reblog',
      sourceActorId: account.id,
      statusId: status.id,
      isRead: true,
      createdAt: currentTime,
      updatedAt: currentTime,
      account,
      status: null
    })

    expect(
      screen.getByText('This post is no longer available.')
    ).toBeInTheDocument()
  })

  it('renders unavailable notification text for unknown notification types', () => {
    renderNotificationItem({
      id: 'notification-unknown',
      actorId: account.id,
      type: 'unknown' as never,
      sourceActorId: account.id,
      isRead: true,
      createdAt: currentTime,
      updatedAt: currentTime,
      account
    })

    expect(
      screen.getByText('This notification is no longer available.')
    ).toBeInTheDocument()
  })
})
