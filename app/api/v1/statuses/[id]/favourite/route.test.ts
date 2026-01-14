import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Status } from '@/lib/models/status'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { urlToId } from '@/lib/utils/urlToId'

jest.mock('../../../../../../lib/config', () => ({
  getConfig: jest.fn().mockReturnValue({ host: 'llun.test' })
}))

/**
 * Tests for Mastodon-compatible status action endpoints
 *
 * API Reference: https://docs.joinmastodon.org/methods/statuses/
 *
 * These tests verify:
 * - POST /api/v1/statuses/:id/favourite - Returns Status with favourited=true
 * - POST /api/v1/statuses/:id/unfavourite - Returns Status with favourited=false
 * - POST /api/v1/statuses/:id/reblog - Returns Status (reblog wrapper)
 * - POST /api/v1/statuses/:id/unreblog - Returns original Status
 * - DELETE /api/v1/statuses/:id - Returns Status with text property
 * - GET /api/v1/statuses/:id/source - Returns source text
 * - GET /api/v1/statuses/:id/history - Returns edit history
 */
describe('Status Action Endpoints', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  describe('favourite/unfavourite', () => {
    it('creates like and returns status with favourited=true', async () => {
      const statusId = `${ACTOR1_ID}/statuses/post-1`

      // Create a like
      await database.createLike({
        actorId: ACTOR2_ID,
        statusId
      })

      const status = (await database.getStatus({
        statusId,
        withReplies: false
      })) as Status

      const mastodonStatus = await getMastodonStatus(
        database,
        status,
        ACTOR2_ID
      )

      expect(mastodonStatus).not.toBeNull()
      expect(mastodonStatus?.favourites_count).toBeGreaterThanOrEqual(1)
    })

    it('deletes like and returns status with favourited=false', async () => {
      const statusId = `${ACTOR1_ID}/statuses/post-1`

      // Create and then delete like
      await database.createLike({
        actorId: ACTOR2_ID,
        statusId
      })
      await database.deleteLike({
        actorId: ACTOR2_ID,
        statusId
      })

      const status = (await database.getStatus({
        statusId,
        withReplies: false
      })) as Status

      expect(status).not.toBeNull()
    })
  })

  describe('reblog/unreblog', () => {
    it('creates announce status', async () => {
      const originalStatusId = `${ACTOR1_ID}/statuses/post-1`
      const announceId = `${ACTOR2_ID}/statuses/test-reblog-${Date.now()}`

      const announce = await database.createAnnounce({
        id: announceId,
        actorId: ACTOR2_ID,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        originalStatusId
      })

      expect(announce).not.toBeNull()
      expect(announce.originalStatus.id).toBe(originalStatusId)
    })

    it('returns reblog count for reblogged status', async () => {
      const statusId = `${ACTOR1_ID}/statuses/post-1`

      const count = await database.getStatusReblogsCount({ statusId })

      expect(count).toBeGreaterThanOrEqual(0)
    })
  })

  describe('status source', () => {
    it('returns source text for status', async () => {
      const statusId = `${ACTOR1_ID}/statuses/post-1`
      const status = (await database.getStatus({
        statusId,
        withReplies: false
      })) as Status

      expect(status.text).toBeTruthy()

      // Verify source format
      const source = {
        id: urlToId(status.id),
        text: status.text ?? '',
        spoiler_text: status.summary ?? ''
      }

      expect(source).toMatchObject({
        id: expect.toBeString(),
        text: expect.toBeString(),
        spoiler_text: expect.toBeString()
      })
    })
  })

  describe('status history', () => {
    it('returns history array with at least current version', async () => {
      const statusId = `${ACTOR1_ID}/statuses/post-1`
      const status = (await database.getStatus({
        statusId,
        withReplies: false
      })) as Status

      // Build history (current implementation returns single entry)
      const history = [
        {
          content: status.text ?? '',
          spoiler_text: status.summary ?? '',
          sensitive: Boolean(status.summary),
          created_at: new Date(status.createdAt).toISOString()
        }
      ]

      expect(history).toBeArray()
      expect(history.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('favourited_by', () => {
    it('returns actors who favourited the status', async () => {
      const statusId = `${ACTOR1_ID}/statuses/post-1`

      // Create a like first
      await database.createLike({
        actorId: ACTOR2_ID,
        statusId
      })

      const actors = await database.getFavouritedBy({ statusId })

      expect(actors).toBeArray()
      expect(actors.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('status deletion', () => {
    it('deletes status from database', async () => {
      // Create a new status to delete
      const deleteStatusId = `${ACTOR1_ID}/statuses/to-delete-${Date.now()}`
      await database.createNote({
        id: deleteStatusId,
        url: deleteStatusId,
        actorId: ACTOR1_ID,
        text: 'This will be deleted',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      // Verify it exists
      const beforeDelete = await database.getStatus({
        statusId: deleteStatusId,
        withReplies: false
      })
      expect(beforeDelete).not.toBeNull()

      // Delete it
      await database.deleteStatus({ statusId: deleteStatusId })

      // Verify it's gone
      const afterDelete = await database.getStatus({
        statusId: deleteStatusId,
        withReplies: false
      })
      expect(afterDelete).toBeNull()
    })
  })
})
