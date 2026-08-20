import { randomUUID } from 'node:crypto'

import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'

describe('LinkPreviewDatabase', () => {
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  afterAll(async () => {
    await Promise.all(table.map((item) => item[1].destroy()))
  })

  describe.each(table)('%s', (_, database) => {
    beforeAll(async () => {
      await seedDatabase(database as Database)
    })

    const uniqueHash = () => randomUUID().replaceAll('-', '')
    const uniqueStatusId = (name: string) =>
      `${ACTOR1_ID}/statuses/link-preview-${name}-${randomUUID()}`

    describe('upsertLinkPreview', () => {
      it('stores a completed card and reads it back', async () => {
        const urlHash = uniqueHash()
        const created = await database.upsertLinkPreview({
          urlHash,
          url: 'https://example.com/article',
          type: 'link',
          title: 'An article',
          description: 'About things',
          siteName: 'Example',
          authorName: 'Ada',
          authorUrl: 'https://example.com/ada',
          imageUrl: 'https://example.com/image.png',
          imageWidth: 1200,
          imageHeight: 630,
          publishedAt: 1700000000000,
          fetchStatus: 'completed'
        })

        expect(created).toMatchObject({
          urlHash,
          url: 'https://example.com/article',
          title: 'An article',
          description: 'About things',
          siteName: 'Example',
          authorName: 'Ada',
          imageUrl: 'https://example.com/image.png',
          imageWidth: 1200,
          imageHeight: 630,
          fetchStatus: 'completed'
        })
        expect(created.publishedAt).toBe(1700000000000)

        const fetched = await database.getLinkPreview({ urlHash })
        expect(fetched).toMatchObject({
          urlHash,
          title: 'An article',
          fetchStatus: 'completed'
        })
      })

      it('replaces the stored card when the same url is fetched again', async () => {
        const urlHash = uniqueHash()
        await database.upsertLinkPreview({
          urlHash,
          url: 'https://example.com/changing',
          title: 'Old title',
          fetchStatus: 'completed'
        })

        const updated = await database.upsertLinkPreview({
          urlHash,
          url: 'https://example.com/changing',
          title: 'New title',
          fetchStatus: 'completed'
        })

        expect(updated.title).toBe('New title')
        const fetched = await database.getLinkPreview({ urlHash })
        expect(fetched?.title).toBe('New title')
      })

      it('stores a failed row as a negative cache entry', async () => {
        const urlHash = uniqueHash()
        await database.upsertLinkPreview({
          urlHash,
          url: 'https://unreachable.example.com/',
          fetchStatus: 'failed',
          error: 'ERR_UNSAFE_REMOTE_URL'
        })

        const fetched = await database.getLinkPreview({ urlHash })
        expect(fetched).toMatchObject({
          fetchStatus: 'failed',
          error: 'ERR_UNSAFE_REMOTE_URL',
          title: null
        })
      })

      it('returns null for a url that was never fetched', async () => {
        expect(
          await database.getLinkPreview({ urlHash: uniqueHash() })
        ).toBeNull()
      })
    })

    describe('getStatusLinkPreviews', () => {
      it('returns cards for the requested statuses keyed by status id', async () => {
        const urlHash = uniqueHash()
        const statusId = uniqueStatusId('hydrate')
        await database.upsertLinkPreview({
          urlHash,
          url: 'https://example.com/hydrate',
          title: 'Hydrated',
          fetchStatus: 'completed'
        })
        await database.linkStatusLinkPreview({ statusId, urlHash })

        const previews = await database.getStatusLinkPreviews({
          statusIds: [statusId]
        })

        expect(previews.get(statusId)).toMatchObject({
          urlHash,
          title: 'Hydrated'
        })
      })

      it('omits a status whose card has not finished fetching', async () => {
        const urlHash = uniqueHash()
        const statusId = uniqueStatusId('pending')
        await database.upsertLinkPreview({
          urlHash,
          url: 'https://example.com/pending',
          fetchStatus: 'pending'
        })
        await database.linkStatusLinkPreview({ statusId, urlHash })

        const previews = await database.getStatusLinkPreviews({
          statusIds: [statusId]
        })

        expect(previews.has(statusId)).toBe(false)
      })

      it('returns an empty map when given no status ids', async () => {
        const previews = await database.getStatusLinkPreviews({ statusIds: [] })
        expect(previews.size).toBe(0)
      })

      it('shares one card between every status linking the same url', async () => {
        const urlHash = uniqueHash()
        const firstStatusId = uniqueStatusId('shared-one')
        const secondStatusId = uniqueStatusId('shared-two')
        await database.upsertLinkPreview({
          urlHash,
          url: 'https://example.com/shared',
          title: 'Shared card',
          fetchStatus: 'completed'
        })
        await database.linkStatusLinkPreview({
          statusId: firstStatusId,
          urlHash
        })
        await database.linkStatusLinkPreview({
          statusId: secondStatusId,
          urlHash
        })

        const previews = await database.getStatusLinkPreviews({
          statusIds: [firstStatusId, secondStatusId]
        })

        expect(previews.get(firstStatusId)?.title).toBe('Shared card')
        expect(previews.get(secondStatusId)?.title).toBe('Shared card')
      })
    })

    describe('linkStatusLinkPreview', () => {
      it('moves a status to a different card when it is edited', async () => {
        const firstHash = uniqueHash()
        const secondHash = uniqueHash()
        const statusId = uniqueStatusId('relink')
        await database.upsertLinkPreview({
          urlHash: firstHash,
          url: 'https://example.com/first',
          title: 'First',
          fetchStatus: 'completed'
        })
        await database.upsertLinkPreview({
          urlHash: secondHash,
          url: 'https://example.com/second',
          title: 'Second',
          fetchStatus: 'completed'
        })

        await database.linkStatusLinkPreview({ statusId, urlHash: firstHash })
        await database.linkStatusLinkPreview({ statusId, urlHash: secondHash })

        const previews = await database.getStatusLinkPreviews({
          statusIds: [statusId]
        })
        expect(previews.get(statusId)?.title).toBe('Second')
      })
    })

    describe('deleteStatusLinkPreview', () => {
      it('removes the card from the status without deleting the cached card', async () => {
        const urlHash = uniqueHash()
        const statusId = uniqueStatusId('unlink')
        await database.upsertLinkPreview({
          urlHash,
          url: 'https://example.com/unlink',
          title: 'Unlinked',
          fetchStatus: 'completed'
        })
        await database.linkStatusLinkPreview({ statusId, urlHash })

        await database.deleteStatusLinkPreview({ statusId })

        const previews = await database.getStatusLinkPreviews({
          statusIds: [statusId]
        })
        expect(previews.has(statusId)).toBe(false)
        // The per-url cache survives so other statuses keep their card.
        expect(await database.getLinkPreview({ urlHash })).not.toBeNull()
      })

      it('is a no-op for a status that has no card', async () => {
        await expect(
          database.deleteStatusLinkPreview({
            statusId: uniqueStatusId('missing')
          })
        ).resolves.toBeUndefined()
      })
    })
  })
})
