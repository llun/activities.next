import { type ReactNode, isValidElement } from 'react'

import type { Notification } from '@/lib/types/database/operations'
import { type Follow, FollowStatus } from '@/lib/types/domain/follow'

import { NotificationsList } from './NotificationsList'
import Page from './page'

// Walk the (unrendered) element tree the Server Component returns and find the
// first element of a given component type, so a test can read the props the
// page forwards to a child without rendering the whole client tree.
const findElementByType = (
  node: ReactNode,
  type: unknown
): { props: Record<string, unknown> } | null => {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElementByType(child, type)
      if (found) return found
    }
    return null
  }
  if (!isValidElement(node)) return null
  if (node.type === type) return node as { props: Record<string, unknown> }
  const props = node.props as { children?: ReactNode }
  return findElementByType(props?.children, type)
}

const mockGetConfig = vi.fn()
const mockGetDatabase = vi.fn()
const mockGetServerAuthSession = vi.fn()
const mockGetActorFromSession = vi.fn()

vi.mock('@/lib/config', () => ({
  getConfig: () => mockGetConfig()
}))

vi.mock('@/lib/database', () => ({
  getDatabase: () => mockGetDatabase()
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerAuthSession()
}))

vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: (...args: unknown[]) => mockGetActorFromSession(...args)
}))

const currentTime = new Date('2026-05-17T12:00:00.000Z').getTime()
const viewerActorId = 'https://llun.social/users/llun'
const requesterActorId = 'https://remote.example/users/alice'

const followRequestNotification: Notification = {
  id: 'notification-follow-request',
  actorId: viewerActorId,
  type: 'follow_request',
  sourceActorId: requesterActorId,
  followId: 'follow-1',
  isRead: false,
  filtered: false,
  groupKey: 'ungrouped-notification-follow-request',
  createdAt: currentTime,
  updatedAt: currentTime
}

const likeNotification: Notification = {
  id: 'notification-like',
  actorId: viewerActorId,
  type: 'like',
  sourceActorId: 'https://remote.example/users/bob',
  isRead: true,
  filtered: false,
  groupKey: 'ungrouped-notification-like',
  createdAt: currentTime - 1,
  updatedAt: currentTime - 1
}

const acceptedFollow: Follow = {
  id: 'follow-1',
  actorId: requesterActorId,
  actorHost: 'remote.example',
  targetActorId: viewerActorId,
  targetActorHost: 'llun.social',
  status: FollowStatus.enum.Accepted,
  inbox: 'https://remote.example/users/alice/inbox',
  sharedInbox: 'https://remote.example/inbox',
  reblogs: true,
  notify: false,
  languages: null,
  createdAt: currentTime,
  updatedAt: currentTime
}

const buildDatabase = (notifications: Notification[]) => ({
  getNotifications: vi.fn().mockResolvedValue(notifications),
  getNotificationsCount: vi.fn().mockResolvedValue(notifications.length),
  getMastodonActorFromId: vi.fn().mockResolvedValue(null),
  getStatus: vi.fn().mockResolvedValue(null),
  getCollectionById: vi.fn().mockResolvedValue(null),
  getFollowFromId: vi.fn().mockResolvedValue(acceptedFollow),
  getAcceptedOrRequestedFollow: vi.fn().mockResolvedValue(null)
})

describe('notifications page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetConfig.mockReturnValue({ host: 'llun.social' })
    mockGetServerAuthSession.mockResolvedValue({ user: { id: 'account-1' } })
    mockGetActorFromSession.mockResolvedValue({ id: viewerActorId })
  })

  it('resolves the follow state by the notification followId for follow_request rows', async () => {
    const database = buildDatabase([
      followRequestNotification,
      likeNotification
    ])
    mockGetDatabase.mockReturnValue(database)

    const element = await Page({ searchParams: Promise.resolve({}) })

    // The exact follow recorded on the notification is looked up; the
    // requester/viewer pair fallback is not used when a followId exists.
    expect(database.getFollowFromId).toHaveBeenCalledTimes(1)
    expect(database.getFollowFromId).toHaveBeenCalledWith({
      followId: 'follow-1'
    })
    expect(database.getAcceptedOrRequestedFollow).not.toHaveBeenCalled()

    // The resolved status must actually reach the list, not just be computed:
    // assert the follow_request row is forwarded with followRequestStatus and
    // that other rows carry none.
    const list = findElementByType(element, NotificationsList)
    const forwarded = (
      list?.props.notifications as Array<{
        id: string
        followRequestStatus?: string
      }>
    ).reduce<Record<string, string | undefined>>((map, notification) => {
      map[notification.id] = notification.followRequestStatus
      return map
    }, {})
    expect(forwarded[followRequestNotification.id]).toBe('accepted')
    expect(forwarded[likeNotification.id]).toBeUndefined()
  })

  it('does not resolve follow state for non follow_request rows', async () => {
    const database = buildDatabase([likeNotification])
    mockGetDatabase.mockReturnValue(database)

    await Page({ searchParams: Promise.resolve({}) })

    expect(database.getFollowFromId).not.toHaveBeenCalled()
    expect(database.getAcceptedOrRequestedFollow).not.toHaveBeenCalled()
  })
})
