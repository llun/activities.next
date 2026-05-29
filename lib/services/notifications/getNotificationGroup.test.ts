import { getNotificationGroup } from '@/lib/services/notifications/getNotificationGroup'
import { GroupedNotification } from '@/lib/services/notifications/groupNotifications'
import { urlToId } from '@/lib/utils/urlToId'

const base: GroupedNotification = {
  id: 'n1',
  actorId: 'https://llun.test/users/me',
  type: 'like',
  sourceActorId: 'https://other.test/users/alice',
  statusId: 'https://other.test/statuses/1',
  isRead: false,
  filtered: false,
  groupKey: 'like:https://other.test/statuses/1',
  createdAt: 1000,
  updatedAt: 1000
}

describe('#getNotificationGroup', () => {
  it('maps a grouped notification to a Mastodon NotificationGroup', () => {
    const { group } = getNotificationGroup({
      ...base,
      groupedActors: [
        'https://other.test/users/alice',
        'https://other.test/users/bob'
      ],
      groupedCount: 2
    })

    expect(group).toMatchObject({
      group_key: 'like:https://other.test/statuses/1',
      notifications_count: 2,
      type: 'favourite',
      most_recent_notification_id: 'n1',
      status_id: urlToId('https://other.test/statuses/1')
    })
    expect(group.sample_account_ids).toEqual([
      urlToId('https://other.test/users/alice'),
      urlToId('https://other.test/users/bob')
    ])
  })

  it('uses the notification id as the group key for ungrouped notifications', () => {
    const { group, sampleActorIds } = getNotificationGroup({
      ...base,
      groupKey: undefined,
      groupedActors: undefined,
      groupedCount: 1
    })

    expect(group.group_key).toBe('n1')
    expect(group.notifications_count).toBe(1)
    expect(sampleActorIds).toEqual(['https://other.test/users/alice'])
  })

  it('omits status_id for notifications without a status', () => {
    const { group, statusId } = getNotificationGroup({
      ...base,
      type: 'follow',
      statusId: undefined
    })

    expect(group.status_id).toBeUndefined()
    expect(group.type).toBe('follow')
    expect(statusId).toBeUndefined()
  })
})
