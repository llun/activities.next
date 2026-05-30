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

const accountWithAvatar: Mastodon.Account = {
  ...account,
  avatar: 'https://llun.social/avatar.png',
  avatar_static: 'https://llun.social/avatar.png'
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
  return renderNotificationItemWithOptions(notification)
}

const renderNotificationItemWithOptions = (
  notification: NotificationItemNotification,
  options: {
    currentActorId?: string
    isRead?: boolean
    observeElement?: (element: HTMLElement | null) => void
  } = {}
) => {
  return render(
    <NotificationItem
      notification={notification}
      currentActorId={options.currentActorId ?? notification.actorId}
      host="llun.social"
      isRead={options.isRead ?? true}
      currentTime={currentTime}
      observeElement={options.observeElement ?? jest.fn()}
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
      account: accountWithAvatar,
      status
    })

    expect(
      screen.getByText(/Your fitness activity was imported/)
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
    const activityImportRow = container.querySelector('.flex.items-start.gap-4')
    expect(activityImportRow).toBeInTheDocument()
    expect(
      activityImportRow?.querySelector('[aria-hidden="true"]')
    ).toHaveClass('size-12', 'shrink-0')
    expect(container.querySelector('img')).toBeNull()
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
      screen.getByText(/Your fitness activities were imported/)
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

  it.each([
    ['like', /and 2 others liked your/],
    ['reply', /and 2 others replied to your/],
    ['mention', /and 2 others mentioned you in a/],
    ['reblog', /and 2 others reblogged your/]
  ] as const)(
    'renders grouped %s notifications without grouped account data',
    (type, expectedText) => {
      renderNotificationItem({
        id: `notification-${type}`,
        actorId: 'https://llun.social/users/llun',
        type,
        sourceActorId: account.id,
        statusId: status.id,
        isRead: true,
        createdAt: currentTime,
        updatedAt: currentTime,
        account,
        status,
        groupedCount: 3
      })

      expect(screen.getByText(expectedText)).toBeInTheDocument()
    }
  )

  it('renders grouped follow notifications without grouped account data', () => {
    renderNotificationItem({
      id: 'notification-follow',
      actorId: 'https://llun.social/users/llun',
      type: 'follow',
      sourceActorId: account.id,
      isRead: true,
      createdAt: currentTime,
      updatedAt: currentTime,
      account,
      groupedCount: 3
    })

    expect(
      screen.getByText(/and 2 others started following you/)
    ).toBeInTheDocument()
  })

  it('renders grouped activity import notifications with generic import copy', () => {
    renderNotificationItem({
      id: 'notification-activity-import',
      actorId: account.id,
      type: 'activity_import',
      sourceActorId: account.id,
      statusId: status.id,
      isRead: true,
      createdAt: currentTime,
      updatedAt: currentTime,
      account,
      status,
      groupedCount: 3
    })

    expect(
      screen.getByText(/Your fitness activities were imported/)
    ).toBeInTheDocument()
  })

  it.each([
    ['activity_import', 'This imported activity is no longer available.'],
    ['like', 'This post is no longer available.'],
    ['reply', 'This post is no longer available.'],
    ['mention', 'This post is no longer available.'],
    ['reblog', 'This post is no longer available.']
  ] as const)(
    'renders unavailable status text for stale %s notifications',
    (type, expectedText) => {
      renderNotificationItem({
        id: `notification-stale-${type}`,
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

      expect(screen.getByText(expectedText)).toBeInTheDocument()
    }
  )

  it('observes unread stale status-backed notifications so they can be marked read', () => {
    const observeElement = jest.fn()

    renderNotificationItemWithOptions(
      {
        id: 'notification-unread-stale',
        actorId: account.id,
        type: 'activity_import',
        sourceActorId: account.id,
        statusId: status.id,
        isRead: false,
        createdAt: currentTime,
        updatedAt: currentTime,
        account,
        status: null
      },
      {
        isRead: false,
        observeElement
      }
    )

    expect(
      screen.getByText('This imported activity is no longer available.')
    ).toBeInTheDocument()
    expect(observeElement).toHaveBeenCalledTimes(1)
    expect(observeElement.mock.calls[0][0]).toHaveAttribute(
      'data-notification-id',
      'notification-unread-stale'
    )
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
