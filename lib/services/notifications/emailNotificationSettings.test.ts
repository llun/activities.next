import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { TEST_DOMAIN } from '@/lib/stub/const'

import { shouldSendEmailForNotification } from './emailNotificationSettings'

describe('emailNotificationSettings', () => {
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
      const username = `email-${crypto.randomUUID().slice(0, 8)}`
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

    describe('shouldSendEmailForNotification', () => {
      it('returns true when no email notification settings are configured', async () => {
        const result = await shouldSendEmailForNotification(
          database,
          actorId,
          'like'
        )
        expect(result).toBe(true)
      })

      it('returns true when notification type is enabled', async () => {
        await database.updateActor({
          actorId,
          emailNotifications: {
            like: true,
            follow: false
          }
        })

        const result = await shouldSendEmailForNotification(
          database,
          actorId,
          'like'
        )
        expect(result).toBe(true)
      })

      it('returns false when notification type is disabled', async () => {
        await database.updateActor({
          actorId,
          emailNotifications: {
            like: false
          }
        })

        const result = await shouldSendEmailForNotification(
          database,
          actorId,
          'like'
        )
        expect(result).toBe(false)
      })

      it('returns true when notification type is not explicitly set', async () => {
        await database.updateActor({
          actorId,
          emailNotifications: {
            follow: false
          }
        })

        const result = await shouldSendEmailForNotification(
          database,
          actorId,
          'reblog'
        )
        expect(result).toBe(true)
      })
    })
  })
})
