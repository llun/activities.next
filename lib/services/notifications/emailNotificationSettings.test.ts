import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import {
  TEST_DOMAIN,
  TEST_EMAIL,
  TEST_PASSWORD_HASH,
  TEST_USERNAME3
} from '@/lib/stub/const'

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

    beforeAll(async () => {
      await database.createAccount({
        email: TEST_EMAIL,
        username: TEST_USERNAME3,
        passwordHash: TEST_PASSWORD_HASH,
        domain: TEST_DOMAIN,
        privateKey: 'privateKey1',
        publicKey: 'publicKey1'
      })

      actorId = `https://${TEST_DOMAIN}/users/${TEST_USERNAME3}`
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
