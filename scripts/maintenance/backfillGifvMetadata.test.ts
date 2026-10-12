import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest'

import type { Db } from '@/lib/database/kysely'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { resolveAnimationMetadata } from '@/lib/services/medias/animationMetadata'

import { parseArgs, runBackfill } from './backfillGifvMetadata'

vi.mock('@/lib/services/medias/animationMetadata', () => ({
  resolveAnimationMetadata: vi.fn()
}))

describe('backfillGifvMetadata parseArgs', () => {
  it('defaults to live run with batch size 50', () => {
    expect(parseArgs([])).toEqual({ dryRun: false, batchSize: 50 })
  })

  it('accepts --dry-run flag', () => {
    expect(parseArgs(['--dry-run'])).toEqual({ dryRun: true, batchSize: 50 })
  })

  it('accepts --batch-size flag', () => {
    expect(parseArgs(['--batch-size', '100'])).toEqual({
      dryRun: false,
      batchSize: 100
    })
  })
})

describe('runBackfill', () => {
  // The real `statuses` and `attachments` tables, from the same schema dump the
  // app migrates with. Honours TEST_DATABASE_TYPE, so it runs on PostgreSQL in
  // CI.
  const created = createTestDatabase()
  const db: Db = created.db

  beforeAll(async () => {
    await created.prepare()
    await created.database.migrate()
  })

  beforeEach(async () => {
    await db.deleteFrom('attachments').execute()
    await db.deleteFrom('statuses').execute()
    vi.clearAllMocks()
  })

  afterAll(async () => {
    await created.destroy()
  })

  const attachmentById = (id: string) =>
    db
      .selectFrom('attachments')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow()

  it('updates matching video attachments with resolved gifv metadata', async () => {
    await db
      .insertInto('statuses')
      .values({
        id: 'stat-1',
        url: 'https://mastodon.social/@cheeaun/111000',
        actorId: 'https://mastodon.social/users/cheeaun'
      })
      .execute()

    await db
      .insertInto('attachments')
      .values({
        id: 'att-1',
        statusId: 'stat-1',
        actorId: 'https://mastodon.social/users/cheeaun',
        mediaType: 'video/mp4',
        url: 'https://files.mastodon.social/video.mp4',
        playbackType: null,
        thumbnailUrl: null
      })
      .execute()

    vi.mocked(resolveAnimationMetadata).mockResolvedValueOnce({
      'https://files.mastodon.social/video.mp4': {
        playbackType: 'gifv',
        previewUrl: 'https://files.mastodon.social/preview.jpg'
      }
    })

    await runBackfill({ dryRun: false, batchSize: 10 }, db)

    const updated = await attachmentById('att-1')
    expect(updated.playbackType).toBe('gifv')
    expect(updated.thumbnailUrl).toBe(
      'https://files.mastodon.social/preview.jpg'
    )
  })

  it('does not write changes in dry-run mode', async () => {
    await db
      .insertInto('statuses')
      .values({
        id: 'stat-2',
        url: 'https://mastodon.social/@cheeaun/222000',
        actorId: 'https://mastodon.social/users/cheeaun'
      })
      .execute()

    await db
      .insertInto('attachments')
      .values({
        id: 'att-2',
        statusId: 'stat-2',
        actorId: 'https://mastodon.social/users/cheeaun',
        mediaType: 'video/mp4',
        url: 'https://files.mastodon.social/video2.mp4',
        playbackType: null,
        thumbnailUrl: null
      })
      .execute()

    vi.mocked(resolveAnimationMetadata).mockResolvedValueOnce({
      'https://files.mastodon.social/video2.mp4': {
        playbackType: 'gifv',
        previewUrl: 'https://files.mastodon.social/preview2.jpg'
      }
    })

    await runBackfill({ dryRun: true, batchSize: 10 }, db)

    const row = await attachmentById('att-2')
    expect(row.playbackType).toBeNull()
    expect(row.thumbnailUrl).toBeNull()
  })

  it('advances past failing attachments without infinite looping', async () => {
    await db
      .insertInto('attachments')
      .values([
        {
          id: 'att-fail',
          statusId: 'stat-fail',
          actorId: 'act-1',
          mediaType: 'video/mp4',
          url: 'https://files.mastodon.social/fail.mp4',
          playbackType: null
        },
        {
          id: 'att-ok',
          statusId: 'stat-ok',
          actorId: 'act-1',
          mediaType: 'video/mp4',
          url: 'https://files.mastodon.social/ok.mp4',
          playbackType: null
        }
      ])
      .execute()

    vi.mocked(resolveAnimationMetadata)
      .mockRejectedValueOnce(new Error('Network failure'))
      .mockResolvedValueOnce({
        'https://files.mastodon.social/ok.mp4': {
          playbackType: 'video',
          previewUrl: null
        }
      })

    // Should complete cleanly without hanging
    await runBackfill({ dryRun: false, batchSize: 1 }, db)

    const okRow = await attachmentById('att-ok')
    expect(okRow.playbackType).toBe('video')
  })

  it('leaves playbackType null for transient non-definitive failures so they can be retried', async () => {
    await db
      .insertInto('attachments')
      .values({
        id: 'att-transient',
        statusId: 'stat-transient',
        actorId: 'act-1',
        mediaType: 'video/mp4',
        url: 'https://files.mastodon.social/transient.mp4',
        playbackType: null
      })
      .execute()

    vi.mocked(resolveAnimationMetadata).mockResolvedValueOnce({
      'https://files.mastodon.social/transient.mp4': {
        playbackType: 'unknown',
        previewUrl: null,
        definitive: false
      }
    })

    await runBackfill({ dryRun: false, batchSize: 10 }, db)

    const row = await attachmentById('att-transient')
    expect(row.playbackType).toBeNull()
  })

  it('updates playbackType to unknown when failure is definitive', async () => {
    await db
      .insertInto('attachments')
      .values({
        id: 'att-definitive',
        statusId: 'stat-definitive',
        actorId: 'act-1',
        mediaType: 'video/mp4',
        url: 'https://files.mastodon.social/definitive.mp4',
        playbackType: null
      })
      .execute()

    vi.mocked(resolveAnimationMetadata).mockResolvedValueOnce({
      'https://files.mastodon.social/definitive.mp4': {
        playbackType: 'unknown',
        previewUrl: null,
        definitive: true
      }
    })

    await runBackfill({ dryRun: false, batchSize: 10 }, db)

    const row = await attachmentById('att-definitive')
    expect(row.playbackType).toBe('unknown')
  })

  it('leaves an attachment that already has a playbackType alone', async () => {
    await db
      .insertInto('attachments')
      .values({
        id: 'att-done',
        statusId: 'stat-done',
        actorId: 'act-1',
        mediaType: 'video/mp4',
        url: 'https://files.mastodon.social/done.mp4',
        playbackType: 'gifv'
      })
      .execute()

    await runBackfill({ dryRun: false, batchSize: 10 }, db)

    expect(resolveAnimationMetadata).not.toHaveBeenCalled()
    expect((await attachmentById('att-done')).playbackType).toBe('gifv')
  })
})
