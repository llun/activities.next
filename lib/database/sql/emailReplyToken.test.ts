import crypto from 'crypto'

import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { TEST_DOMAIN } from '@/lib/stub/const'

const ACTOR_ID = `https://${TEST_DOMAIN}/users/test1`
const STATUS_ID = `https://${TEST_DOMAIN}/users/test1/statuses/post-1`

// A fresh 64-char hex digest per call, so the unique index on `tokenHash` can
// never collide between cases sharing one in-memory database.
const hash = () => crypto.randomBytes(32).toString('hex')

describe('EmailReplyTokenDatabase', () => {
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  afterAll(async () => {
    await Promise.all(table.map((item) => item[1].destroy()))
  })

  describe.each(table)('%s', (_, database) => {
    it('stores a token and reads it back by hash', async () => {
      const tokenHash = hash()
      const expiresAt = Date.now() + 60_000

      const created = await database.createEmailReplyToken({
        tokenHash,
        actorId: ACTOR_ID,
        statusId: STATUS_ID,
        notificationType: 'mention',
        expiresAt
      })

      expect(created).toMatchObject({
        tokenHash,
        actorId: ACTOR_ID,
        statusId: STATUS_ID,
        notificationType: 'mention',
        useCount: 0,
        lastUsedAt: null,
        expiresAt
      })
      expect(created.id).toEqual(expect.any(String))
      expect(created.createdAt).toBeGreaterThan(0)

      await expect(
        database.getEmailReplyToken({ tokenHash })
      ).resolves.toMatchObject({ id: created.id, expiresAt })
    })

    it('returns null for a hash that was never stored', async () => {
      await expect(
        database.getEmailReplyToken({ tokenHash: hash() })
      ).resolves.toBeNull()
    })

    it('increments useCount and stamps lastUsedAt on each recorded use', async () => {
      const tokenHash = hash()
      const created = await database.createEmailReplyToken({
        tokenHash,
        actorId: ACTOR_ID,
        statusId: STATUS_ID,
        notificationType: 'reply',
        expiresAt: Date.now() + 60_000
      })

      await database.recordEmailReplyTokenUse({ id: created.id })
      const afterFirst = await database.getEmailReplyToken({ tokenHash })
      expect(afterFirst?.useCount).toBe(1)
      expect(afterFirst?.lastUsedAt).toBeGreaterThan(0)

      await database.recordEmailReplyTokenUse({ id: created.id })
      await expect(
        database.getEmailReplyToken({ tokenHash })
      ).resolves.toMatchObject({ useCount: 2 })
    })

    it('deletes only tokens that expired before the given time', async () => {
      const expiredHash = hash()
      const liveHash = hash()
      await database.createEmailReplyToken({
        tokenHash: expiredHash,
        actorId: ACTOR_ID,
        statusId: STATUS_ID,
        notificationType: 'reply',
        expiresAt: Date.now() - 60_000
      })
      await database.createEmailReplyToken({
        tokenHash: liveHash,
        actorId: ACTOR_ID,
        statusId: STATUS_ID,
        notificationType: 'reply',
        expiresAt: Date.now() + 60_000
      })

      const deleted = await database.deleteExpiredEmailReplyTokens({
        before: Date.now()
      })

      expect(deleted).toBeGreaterThanOrEqual(1)
      await expect(
        database.getEmailReplyToken({ tokenHash: expiredHash })
      ).resolves.toBeNull()
      await expect(
        database.getEmailReplyToken({ tokenHash: liveHash })
      ).resolves.not.toBeNull()
    })
  })
})
