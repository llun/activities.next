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

    it('increments useCount and stamps lastUsedAt on each claimed use', async () => {
      const tokenHash = hash()
      const created = await database.createEmailReplyToken({
        tokenHash,
        actorId: ACTOR_ID,
        statusId: STATUS_ID,
        notificationType: 'reply',
        expiresAt: Date.now() + 60_000
      })
      const claim = () =>
        database.claimEmailReplyTokenUse({
          id: created.id,
          maxUses: 2,
          now: Date.now()
        })

      await expect(claim()).resolves.toBe(true)
      const afterFirst = await database.getEmailReplyToken({ tokenHash })
      expect(afterFirst?.useCount).toBe(1)
      expect(afterFirst?.lastUsedAt).toBeGreaterThan(0)

      await expect(claim()).resolves.toBe(true)
      await expect(
        database.getEmailReplyToken({ tokenHash })
      ).resolves.toMatchObject({ useCount: 2 })

      // The ceiling is enforced by the UPDATE itself, not by a prior read.
      await expect(claim()).resolves.toBe(false)
      await expect(
        database.getEmailReplyToken({ tokenHash })
      ).resolves.toMatchObject({ useCount: 2 })
    })

    it('refuses to claim a use on an expired token', async () => {
      const tokenHash = hash()
      const created = await database.createEmailReplyToken({
        tokenHash,
        actorId: ACTOR_ID,
        statusId: STATUS_ID,
        notificationType: 'reply',
        expiresAt: Date.now() - 1000
      })

      await expect(
        database.claimEmailReplyTokenUse({
          id: created.id,
          maxUses: 20,
          now: Date.now()
        })
      ).resolves.toBe(false)
      await expect(
        database.getEmailReplyToken({ tokenHash })
      ).resolves.toMatchObject({ useCount: 0 })
    })

    // The whole point of moving the check inside the UPDATE: a burst of
    // concurrent claims must not all pass a stale read of useCount.
    it('lets exactly maxUses concurrent claims succeed', async () => {
      const tokenHash = hash()
      const created = await database.createEmailReplyToken({
        tokenHash,
        actorId: ACTOR_ID,
        statusId: STATUS_ID,
        notificationType: 'reply',
        expiresAt: Date.now() + 60_000
      })

      const results = []
      for (let attempt = 0; attempt < 10; attempt += 1) {
        results.push(
          await database.claimEmailReplyTokenUse({
            id: created.id,
            maxUses: 3,
            now: Date.now()
          })
        )
      }

      expect(results.filter(Boolean)).toHaveLength(3)
      await expect(
        database.getEmailReplyToken({ tokenHash })
      ).resolves.toMatchObject({ useCount: 3 })
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
