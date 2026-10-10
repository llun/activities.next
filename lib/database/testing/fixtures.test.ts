import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  deleteServerSetting,
  getQueueJobById
} from '@/lib/database/testing/fixtures'

describe('test fixtures', () => {
  const { database, db, prepare, destroy } = createTestDatabase()

  beforeAll(async () => {
    await prepare()
    await database.migrate()
  }, 30000)

  afterAll(async () => {
    await destroy()
  })

  describe('getQueueJobById', () => {
    it('returns the job createQueueJob stored', async () => {
      const created = await database.createQueueJob({
        id: 'fixture-job-1',
        name: 'deliverActivity',
        payload: { id: 'p1', name: 'deliverActivity', data: { a: 1 } },
        maxRetries: 3
      })

      const job = await getQueueJobById(db, 'fixture-job-1')
      expect(job).toEqual(created)
      expect(job).toMatchObject({
        status: 'pending',
        attempts: 0,
        maxRetries: 3,
        claimToken: null,
        payload: { id: 'p1', data: { a: 1 } }
      })
      expect(job?.createdAt).toBeTypeOf('number')
      expect(job?.nextRunAt).toBeTypeOf('number')
    })

    it('returns null for an unknown id', async () => {
      await expect(getQueueJobById(db, 'missing-job')).resolves.toBeNull()
    })
  })

  describe('deleteServerSetting', () => {
    it('deletes a stored setting and reports true', async () => {
      await database.setServerSettings([
        { key: 'posts.maxCharacters', value: 10 }
      ])

      await expect(
        deleteServerSetting(db, { key: 'posts.maxCharacters' })
      ).resolves.toBe(true)
      await expect(database.getAllServerSettings()).resolves.toEqual([])
    })

    it('reports false when the setting was not stored', async () => {
      await expect(
        deleteServerSetting(db, { key: 'never.stored' })
      ).resolves.toBe(false)
    })
  })
})
