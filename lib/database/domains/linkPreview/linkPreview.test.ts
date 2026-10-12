import { randomUUID } from 'node:crypto'

import { linkPreviewQueries } from '@/lib/database/domains/linkPreview/queries'
import {
  type TestDatabaseTable,
  databaseBeforeAll
} from '@/lib/database/testUtils'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { withStaleFirstRead } from '@/lib/database/testing/staleRead'
import { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'

describe('LinkPreviewDatabase', () => {
  const testDb = createTestDatabase()
  const table: TestDatabaseTable = [
    [testDb.backend, testDb.database, testDb.prepare]
  ]

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

    describe('recordLinkPreviewFailure', () => {
      // A card is cached per URL and shared by every status linking that page.
      // Writing a failure as a full-row replace nulled the title/description/
      // image, and getStatusLinkPreviews filters on `completed`, so ONE
      // transient 502 on a weekly refresh made the card vanish from every post
      // that linked it — with no repair path, because the negative cache then
      // suppressed the retry.
      it('keeps a completed card when a later refresh fails', async () => {
        const urlHash = uniqueHash()
        await database.upsertLinkPreview({
          urlHash,
          url: 'https://example.com/popular',
          title: 'A good title',
          description: 'A good description',
          imageUrl: 'https://cdn.example.com/a.png',
          siteName: 'Example',
          fetchStatus: 'completed'
        })

        await database.recordLinkPreviewFailure({
          urlHash,
          url: 'https://example.com/popular',
          error: 'ERR_HTTP_502'
        })

        const stored = await database.getLinkPreview({ urlHash })
        expect(stored).toMatchObject({
          title: 'A good title',
          description: 'A good description',
          imageUrl: 'https://cdn.example.com/a.png',
          // Still completed, so the card keeps rendering everywhere.
          fetchStatus: 'completed',
          // ...but the failure is recorded for operators.
          error: 'ERR_HTTP_502'
        })
      })

      it('keeps serving the card to every status after a failed refresh', async () => {
        const urlHash = uniqueHash()
        const statusId = uniqueStatusId('survives')
        await database.upsertLinkPreview({
          urlHash,
          url: 'https://example.com/survives',
          title: 'Survivor',
          fetchStatus: 'completed'
        })
        await database.linkStatusLinkPreview({ statusId, urlHash })

        await database.recordLinkPreviewFailure({
          urlHash,
          url: 'https://example.com/survives',
          error: 'ERR_HTTP_502'
        })

        const previews = await database.getStatusLinkPreviews({
          statusIds: [statusId]
        })
        expect(previews.get(statusId)?.title).toBe('Survivor')
      })

      it('records a failure for a url that was never fetched', async () => {
        const urlHash = uniqueHash()
        await database.recordLinkPreviewFailure({
          urlHash,
          url: 'https://unreachable.example.com/',
          error: 'ERR_UNSAFE_REMOTE_URL'
        })

        expect(await database.getLinkPreview({ urlHash })).toMatchObject({
          fetchStatus: 'failed',
          error: 'ERR_UNSAFE_REMOTE_URL',
          title: null
        })
      })

      it('keeps a previously failed row failed', async () => {
        const urlHash = uniqueHash()
        await database.recordLinkPreviewFailure({
          urlHash,
          url: 'https://still-broken.example.com/',
          error: 'ERR_HTTP_500'
        })
        await database.recordLinkPreviewFailure({
          urlHash,
          url: 'https://still-broken.example.com/',
          error: 'ERR_HTTP_503'
        })

        expect(await database.getLinkPreview({ urlHash })).toMatchObject({
          fetchStatus: 'failed',
          error: 'ERR_HTTP_503'
        })
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

    describe('neighbouring cards and racing writers', () => {
      const completeCard = (urlHash: string, title: string) =>
        database.upsertLinkPreview({
          urlHash,
          url: `https://example.com/${title}`,
          title,
          fetchStatus: 'completed'
        })

      it('re-links only the status that was edited', async () => {
        const firstHash = uniqueHash()
        const secondHash = uniqueHash()
        const edited = uniqueStatusId('edited')
        const bystander = uniqueStatusId('bystander')
        await completeCard(firstHash, 'first')
        await completeCard(secondHash, 'second')
        await database.linkStatusLinkPreview({
          statusId: bystander,
          urlHash: firstHash
        })
        await database.linkStatusLinkPreview({
          statusId: edited,
          urlHash: firstHash
        })

        await database.linkStatusLinkPreview({
          statusId: edited,
          urlHash: secondHash
        })

        const previews = await database.getStatusLinkPreviews({
          statusIds: [edited, bystander]
        })
        expect(previews.get(edited)?.title).toBe('second')
        expect(previews.get(bystander)?.title).toBe('first')
      })

      it('unlinks only the status asked for', async () => {
        const urlHash = uniqueHash()
        const unlinked = uniqueStatusId('unlinked')
        const bystander = uniqueStatusId('still-linked')
        await completeCard(urlHash, 'shared')
        await database.linkStatusLinkPreview({
          statusId: bystander,
          urlHash
        })
        await database.linkStatusLinkPreview({
          statusId: unlinked,
          urlHash
        })

        await database.deleteStatusLinkPreview({ statusId: unlinked })

        const previews = await database.getStatusLinkPreviews({
          statusIds: [unlinked, bystander]
        })
        expect([...previews.keys()]).toEqual([bystander])
      })

      it('hydrates only the requested statuses, each with its own card', async () => {
        const firstHash = uniqueHash()
        const secondHash = uniqueHash()
        const requested = uniqueStatusId('requested')
        const other = uniqueStatusId('not-requested')
        await completeCard(firstHash, 'requested-card')
        await completeCard(secondHash, 'other-card')
        await database.linkStatusLinkPreview({
          statusId: other,
          urlHash: secondHash
        })
        await database.linkStatusLinkPreview({
          statusId: requested,
          urlHash: firstHash
        })

        const previews = await database.getStatusLinkPreviews({
          statusIds: [requested]
        })

        expect([...previews.keys()]).toEqual([requested])
        expect(previews.get(requested)).toMatchObject({
          urlHash: firstHash,
          title: 'requested-card'
        })
      })

      it('records a failure on the url asked for and no other', async () => {
        const failing = uniqueHash()
        const completed = uniqueHash()
        const failed = uniqueHash()
        await completeCard(completed, 'neighbour-completed')
        await database.recordLinkPreviewFailure({
          urlHash: failed,
          url: 'https://example.com/neighbour-failed',
          error: 'ERR_HTTP_500'
        })
        await completeCard(failing, 'failing')
        await database.recordLinkPreviewFailure({
          urlHash: failing,
          url: 'https://example.com/failing',
          error: 'ERR_HTTP_502'
        })
        const stillFailing = uniqueHash()
        await database.recordLinkPreviewFailure({
          urlHash: stillFailing,
          url: 'https://example.com/still-failing',
          error: 'ERR_HTTP_500'
        })
        await database.recordLinkPreviewFailure({
          urlHash: stillFailing,
          url: 'https://example.com/still-failing',
          error: 'ERR_HTTP_503'
        })

        await expect(
          database.getLinkPreview({ urlHash: completed })
        ).resolves.toMatchObject({ fetchStatus: 'completed', error: null })
        await expect(
          database.getLinkPreview({ urlHash: failed })
        ).resolves.toMatchObject({
          fetchStatus: 'failed',
          error: 'ERR_HTTP_500'
        })
        await expect(
          database.getLinkPreview({ urlHash: failing })
        ).resolves.toMatchObject({
          fetchStatus: 'completed',
          error: 'ERR_HTTP_502'
        })
        await expect(
          database.getLinkPreview({ urlHash: stillFailing })
        ).resolves.toMatchObject({
          fetchStatus: 'failed',
          error: 'ERR_HTTP_503'
        })
      })

      it('replaces the card of the url that was fetched again and no other', async () => {
        const refetched = uniqueHash()
        const neighbour = uniqueHash()
        await completeCard(neighbour, 'neighbour')
        await completeCard(refetched, 'old')

        await database.upsertLinkPreview({
          urlHash: refetched,
          url: 'https://example.com/old',
          title: 'new',
          fetchStatus: 'completed'
        })

        await expect(
          database.getLinkPreview({ urlHash: neighbour })
        ).resolves.toMatchObject({ title: 'neighbour' })
        await expect(
          database.getLinkPreview({ urlHash: refetched })
        ).resolves.toMatchObject({ title: 'new' })
      })

      it('does not turn a card that completed during a failed refresh back into a failure', async () => {
        const urlHash = uniqueHash()
        await completeCard(urlHash, 'repaired')
        // The refresh read the row while it was still pending, then another
        // job completed it before this failure was written.
        const racing = withStaleFirstRead(testDb.db, 'link_previews', (rows) =>
          rows.map((row) => ({ ...row, fetchStatus: 'pending' }))
        )

        await linkPreviewQueries.recordLinkPreviewFailure(racing, {
          urlHash,
          url: 'https://example.com/repaired',
          error: 'ERR_HTTP_502'
        })

        await expect(
          database.getLinkPreview({ urlHash })
        ).resolves.toMatchObject({
          title: 'repaired',
          fetchStatus: 'completed',
          error: null
        })
      })

      it('does not overwrite a card another job stored while a failure was recorded', async () => {
        const urlHash = uniqueHash()
        await completeCard(urlHash, 'inserted-first')
        // The failure found no row, but one was inserted before its insert.
        const racing = withStaleFirstRead(testDb.db, 'link_previews', () => [])

        await linkPreviewQueries.recordLinkPreviewFailure(racing, {
          urlHash,
          url: 'https://example.com/inserted-first',
          error: 'ERR_HTTP_502'
        })

        await expect(
          database.getLinkPreview({ urlHash })
        ).resolves.toMatchObject({
          title: 'inserted-first',
          fetchStatus: 'completed',
          error: null
        })
      })

      it('keeps the link another request stored while a status was being linked', async () => {
        const firstHash = uniqueHash()
        const secondHash = uniqueHash()
        const statusId = uniqueStatusId('linked-first')
        await completeCard(firstHash, 'first-link')
        await completeCard(secondHash, 'second-link')
        await database.linkStatusLinkPreview({ statusId, urlHash: firstHash })
        // The link is not seen by the check, as if the other request stored
        // it after the check ran.
        const racing = withStaleFirstRead(
          testDb.db,
          'status_link_previews',
          () => []
        )

        await expect(
          linkPreviewQueries.linkStatusLinkPreview(racing, {
            statusId,
            urlHash: secondHash
          })
        ).resolves.toBeUndefined()

        const previews = await database.getStatusLinkPreviews({
          statusIds: [statusId]
        })
        expect(previews.get(statusId)?.title).toBe('first-link')
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
