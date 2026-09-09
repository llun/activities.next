import fetchMock from 'jest-fetch-mock'
import { beforeEach, describe, expect, it } from 'vitest'

import { markNotificationsRead } from './notifications'

describe('notifications client module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  describe('markNotificationsRead', () => {
    it('sends notification IDs and returns true on success', async () => {
      fetchMock.mockResponseOnce('{}', { status: 200 })

      const result = await markNotificationsRead({
        notificationIds: ['notif-1', 'notif-2']
      })

      expect(result).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notification_ids: ['notif-1', 'notif-2']
        })
      })
    })

    it('returns false when response is not ok', async () => {
      fetchMock.mockResponseOnce('Unauthorized', { status: 401 })

      const result = await markNotificationsRead({
        notificationIds: ['notif-1']
      })

      expect(result).toBe(false)
    })
  })
})
