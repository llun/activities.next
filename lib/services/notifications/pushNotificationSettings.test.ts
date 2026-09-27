import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { TEST_DOMAIN } from '@/lib/stub/const'

import { shouldSendPushForNotification } from './pushNotificationSettings'

describe('pushNotificationSettings', () => {
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  afterAll(async () => {
    await Promise.all(table.map((item) => item[1].destroy()))
  })

  describe.each(table)('%s', (_, database) => {
    let actorId: string

    beforeEach(async () => {
      const username = `push-${crypto.randomUUID().slice(0, 8)}`
      actorId = `https://${TEST_DOMAIN}/users/${username}`
      await database.createActor({
        actorId,
        username,
        domain: TEST_DOMAIN,
        followersUrl: `${actorId}/followers`,
        inboxUrl: `${actorId}/inbox`,
        sharedInboxUrl: `https://${TEST_DOMAIN}/inbox`,
        publicKey: 'publicKey1',
        createdAt: Date.now()
      })
    })

    describe('shouldSendPushForNotification', () => {
      it('returns true when no push notification settings are configured', async () => {
        const result = await shouldSendPushForNotification(
          database,
          actorId,
          'like'
        )
        expect(result).toBe(true)
      })

      it('returns true when notification type is enabled', async () => {
        await database.updateActor({
          actorId,
          pushNotifications: {
            like: true,
            follow: false
          }
        })

        const result = await shouldSendPushForNotification(
          database,
          actorId,
          'like'
        )
        expect(result).toBe(true)
      })

      it('returns false when notification type is disabled', async () => {
        await database.updateActor({
          actorId,
          pushNotifications: {
            like: false
          }
        })

        const result = await shouldSendPushForNotification(
          database,
          actorId,
          'like'
        )
        expect(result).toBe(false)
      })

      it('returns true when notification type is not explicitly set', async () => {
        await database.updateActor({
          actorId,
          pushNotifications: {
            follow: false
          }
        })

        const result = await shouldSendPushForNotification(
          database,
          actorId,
          'reblog'
        )
        expect(result).toBe(true)
      })
    })
  })
})
