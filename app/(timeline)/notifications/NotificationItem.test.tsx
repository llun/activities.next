/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { type ComponentProps } from 'react'

import { Mastodon } from '@/lib/types/activitypub'
import { StatusNote, StatusType } from '@/lib/types/domain/status'

import { NotificationItem } from './NotificationItem'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() })
}))

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
    isRead?: boolean
    observeElement?: (element: HTMLElement | null) => void
  } = {}
) => {
  return render(
    <NotificationItem
      notification={notification}
      host="llun.social"
      isRead={options.isRead ?? true}
      currentTime={currentTime}
      observeElement={options.observeElement ?? vi.fn()}
    />
  )
}

// The whole-row overlay link is the only `<a>` styled absolute inset-0.
const overlayLink = (container: HTMLElement) =>
  container.querySelector('a.absolute')

describe('NotificationItem', () => {
  it.each([
    ['like', 'liked your post'],
    ['reblog', 'boosted your post'],
    ['mention', 'mentioned you'],
    ['reply', 'replied to your post']
  ] as const)(
    'renders the %s verb on line 1 with the actor and quoted post below',
    (type, verb) => {
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
        status
      })

      expect(screen.getByText(verb)).toBeInTheDocument()
      // Actor name on its own line, linking to the profile.
      expect(screen.getByRole('link', { name: 'Ride' })).toHaveAttribute(
        'href',
        '/@ride@llun.social'
      )
      // The quoted subject post.
      expect(screen.getByText(/Morning Ride/)).toBeInTheDocument()
    }
  )

  it('renders a type badge glyph for each notification', () => {
    const { container } = renderNotificationItem({
      id: 'notification-badge',
      actorId: 'https://llun.social/users/llun',
      type: 'like',
      sourceActorId: account.id,
      statusId: status.id,
      isRead: true,
      createdAt: currentTime,
      updatedAt: currentTime,
      account,
      status
    })

    expect(
      container.querySelector('span[aria-hidden="true"] svg')
    ).toBeInTheDocument()
  })

  it.each([
    ['like', 'liked your post'],
    ['reply', 'replied to your post'],
    ['mention', 'mentioned you'],
    ['reblog', 'boosted your post']
  ] as const)(
    'collapses grouped %s notifications onto the actor line',
    (type, verb) => {
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

      expect(screen.getByText(verb)).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: 'Ride and 2 others' })
      ).toBeInTheDocument()
    }
  )

  it('renders a follow notification with inline text and a follow-back action', () => {
    renderNotificationItem({
      id: 'notification-follow',
      actorId: 'https://llun.social/users/llun',
      type: 'follow',
      sourceActorId: account.id,
      isRead: true,
      createdAt: currentTime,
      updatedAt: currentTime,
      account
    })

    expect(screen.getByText(/followed you/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ride' })).toHaveAttribute(
      'href',
      '/@ride@llun.social'
    )
    expect(screen.getByText('@ride@llun.social')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Follow back' })
    ).toBeInTheDocument()
  })

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

    expect(screen.getByText(/followed you/)).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Ride and 2 others' })
    ).toBeInTheDocument()
  })

  // Regression: a follow request must always read as a follow request, with the
  // actor named, even before/without the action buttons (the old card showed an
  // empty avatar + buttons with no text).
  it('renders a follow-request notification with descriptive text and actions', () => {
    renderNotificationItem({
      id: 'notification-follow-request',
      actorId: 'https://llun.social/users/llun',
      type: 'follow_request',
      sourceActorId: account.id,
      isRead: true,
      createdAt: currentTime,
      updatedAt: currentTime,
      account
    })

    expect(screen.getByText(/requested to follow you/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ride' })).toHaveAttribute(
      'href',
      '/@ride@llun.social'
    )
    expect(screen.getByText('@ride@llun.social')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument()
  })

  // Regression: once a request is approved (the viewer follows back) the row must
  // stop offering Approve / Reject and read as already handled. The page resolves
  // the live follow status and forwards it as followRequestStatus.
  it('renders an already-approved follow request without actions', () => {
    renderNotificationItem({
      id: 'notification-follow-request-accepted',
      actorId: 'https://llun.social/users/llun',
      type: 'follow_request',
      sourceActorId: account.id,
      isRead: true,
      createdAt: currentTime,
      updatedAt: currentTime,
      account,
      followRequestStatus: 'accepted'
    })

    expect(screen.getByText(/requested to follow you/)).toBeInTheDocument()
    expect(screen.getByText('Approved')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Approve' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Reject' })
    ).not.toBeInTheDocument()
  })

  it('renders a resolved follow request without actions', () => {
    renderNotificationItem({
      id: 'notification-follow-request-resolved',
      actorId: 'https://llun.social/users/llun',
      type: 'follow_request',
      sourceActorId: account.id,
      isRead: true,
      createdAt: currentTime,
      updatedAt: currentTime,
      account,
      followRequestStatus: 'resolved'
    })

    expect(screen.getByText('No longer pending')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Approve' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Reject' })
    ).not.toBeInTheDocument()
  })

  it('renders activity import notifications with the fitness card and a view link', () => {
    const { container } = renderNotificationItem({
      id: 'notification-activity-import',
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
      screen.getByText('Your fitness activity is ready')
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
    // No nested anchors anywhere in the row.
    container.querySelectorAll('a').forEach((link) => {
      expect(link.querySelector('a')).toBeNull()
    })
    // System rows have no avatar image.
    expect(container.querySelector('img')).toBeNull()
  })

  it('renders grouped activity import notifications with a latest-activity link', () => {
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
      groupedCount: 2,
      groupedIds: ['notification-1', 'notification-2']
    })

    expect(
      screen.getByText('Your fitness activity is ready')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'View latest activity' })
    ).toHaveAttribute('href', expect.stringContaining('/@ride@llun.social/'))
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
    const observeElement = vi.fn()

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

  it.each(['like', 'reply', 'mention', 'reblog'] as const)(
    'renders a focusable whole-row link to the status for %s notifications',
    (type) => {
      const { container } = renderNotificationItem({
        id: `notification-overlay-${type}`,
        actorId: 'https://llun.social/users/llun',
        type,
        sourceActorId: account.id,
        statusId: status.id,
        isRead: true,
        createdAt: currentTime,
        updatedAt: currentTime,
        account,
        status
      })

      const overlay = overlayLink(container)
      expect(overlay).not.toBeNull()
      // Status rows have no inner post link, so the overlay stays focusable.
      expect(overlay).not.toHaveAttribute('tabindex', '-1')
      expect(overlay).not.toHaveAttribute('aria-hidden', 'true')
      expect(overlay).toHaveAttribute(
        'href',
        expect.stringContaining('/@ride@llun.social/')
      )
    }
  )

  it('renders a hidden whole-row link for activity import notifications', () => {
    const { container } = renderNotificationItem({
      id: 'notification-overlay-activity',
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

    const overlay = overlayLink(container)
    expect(overlay).not.toBeNull()
    // The explicit "View activity" link is the accessible target, so the
    // overlay is hidden from the tab order / assistive tech.
    expect(overlay).toHaveAttribute('tabindex', '-1')
    expect(overlay).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders no whole-row overlay link for follow notifications', () => {
    const { container } = renderNotificationItem({
      id: 'notification-no-overlay-follow',
      actorId: 'https://llun.social/users/llun',
      type: 'follow',
      sourceActorId: account.id,
      isRead: true,
      createdAt: currentTime,
      updatedAt: currentTime,
      account
    })

    expect(overlayLink(container)).toBeNull()
  })

  it('renders no whole-row overlay link when the status is no longer available', () => {
    const { container } = renderNotificationItem({
      id: 'notification-overlay-stale',
      actorId: 'https://llun.social/users/llun',
      type: 'like',
      sourceActorId: account.id,
      statusId: status.id,
      isRead: true,
      createdAt: currentTime,
      updatedAt: currentTime,
      account,
      status: null
    })

    expect(overlayLink(container)).toBeNull()
  })

  const collectionNotification = (
    overrides: Partial<NotificationItemNotification> = {}
  ): NotificationItemNotification => ({
    id: 'notification-added-to-collection',
    actorId: 'https://llun.social/users/llun',
    type: 'added_to_collection',
    sourceActorId: account.id,
    isRead: true,
    createdAt: currentTime,
    updatedAt: currentTime,
    account,
    collection: { id: 'col-1', title: 'Fediverse builders' },
    ...overrides
  })

  it('renders the consent actions for an added_to_collection notification', () => {
    render(
      <NotificationItem
        notification={collectionNotification()}
        host="llun.social"
        isRead
        currentTime={currentTime}
        currentAccountId="me"
        observeElement={vi.fn()}
      />
    )

    expect(screen.getByText(/added you to a collection/)).toBeInTheDocument()
    expect(screen.getByText('Fediverse builders')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /show me publicly/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /keep me hidden/i })
    ).toBeInTheDocument()
  })

  it.each([
    [
      'the viewer account id is missing',
      { notification: collectionNotification(), currentAccountId: undefined }
    ],
    [
      'the collection could not be resolved',
      {
        notification: collectionNotification({ collection: null }),
        currentAccountId: 'me'
      }
    ]
  ] as const)(
    'shows only the verb (no consent actions) when %s',
    (_label, { notification, currentAccountId }) => {
      render(
        <NotificationItem
          notification={notification}
          host="llun.social"
          isRead
          currentTime={currentTime}
          currentAccountId={currentAccountId}
          observeElement={vi.fn()}
        />
      )

      expect(screen.getByText(/added you to a collection/)).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /show me publicly/i })
      ).not.toBeInTheDocument()
    }
  )

  it('renders collection_update as an informational row with no consent actions', () => {
    render(
      <NotificationItem
        notification={collectionNotification({
          id: 'notification-collection-update',
          type: 'collection_update'
        })}
        host="llun.social"
        isRead
        currentTime={currentTime}
        currentAccountId="me"
        observeElement={vi.fn()}
      />
    )

    expect(
      screen.getByText(/updated a collection you’re in/)
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /show me publicly/i })
    ).not.toBeInTheDocument()
  })
})
