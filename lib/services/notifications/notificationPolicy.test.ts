import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { DEFAULT_NOTIFICATION_POLICY } from '@/lib/types/database/operations'

import {
  getNotificationPolicyResponse,
  readNotificationPolicyBody,
  toV1NotificationPolicy
} from './notificationPolicy'

describe('getNotificationPolicyResponse', () => {
  it('combines the stored policy with the pending-counts summary', async () => {
    const database = {
      getNotificationPolicy: vi
        .fn()
        .mockResolvedValue({ ...DEFAULT_NOTIFICATION_POLICY }),
      getNotificationsCount: vi.fn().mockResolvedValue(3),
      getNotificationRequestsCount: vi.fn().mockResolvedValue(1)
    } as unknown as Database

    const response = await getNotificationPolicyResponse(
      database,
      'https://llun.test/users/llun'
    )

    expect(response).toEqual({
      ...DEFAULT_NOTIFICATION_POLICY,
      summary: { pending_requests_count: 1, pending_notifications_count: 3 }
    })
    expect(database.getNotificationsCount).toHaveBeenCalledWith({
      actorId: 'https://llun.test/users/llun',
      filteredOnly: true
    })
  })
})

describe('toV1NotificationPolicy', () => {
  it.each([
    {
      description: 'accept maps to filter=false',
      value: 'accept' as const,
      expected: false
    },
    {
      description: 'filter maps to filter=true',
      value: 'filter' as const,
      expected: true
    },
    {
      description: 'drop maps to filter=true',
      value: 'drop' as const,
      expected: true
    }
  ])('$description', ({ value, expected }) => {
    const v1 = toV1NotificationPolicy({
      ...DEFAULT_NOTIFICATION_POLICY,
      for_not_following: value,
      summary: { pending_requests_count: 0, pending_notifications_count: 0 }
    })

    expect(v1.filter_not_following).toBe(expected)
  })

  it('drops the v2-only fields and keeps the summary', () => {
    const v1 = toV1NotificationPolicy({
      ...DEFAULT_NOTIFICATION_POLICY,
      summary: { pending_requests_count: 2, pending_notifications_count: 5 }
    })

    expect(v1).toEqual({
      filter_not_following: false,
      filter_not_followers: false,
      filter_new_accounts: false,
      filter_private_mentions: false,
      summary: { pending_requests_count: 2, pending_notifications_count: 5 }
    })
  })
})

describe('readNotificationPolicyBody', () => {
  it('reads a JSON body', async () => {
    const req = new NextRequest('https://llun.test/api', {
      method: 'PATCH',
      body: JSON.stringify({ for_not_following: 'filter' })
    })

    await expect(readNotificationPolicyBody(req)).resolves.toEqual({
      for_not_following: 'filter'
    })
  })

  it('reads a form-encoded body', async () => {
    const req = new NextRequest('https://llun.test/api', {
      method: 'PATCH',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'for_not_following=filter'
    })

    await expect(readNotificationPolicyBody(req)).resolves.toEqual({
      for_not_following: 'filter'
    })
  })

  it('falls back to an empty object for an unreadable body', async () => {
    const req = new NextRequest('https://llun.test/api', {
      method: 'PATCH',
      body: 'not json'
    })

    await expect(readNotificationPolicyBody(req)).resolves.toEqual({})
  })
})
