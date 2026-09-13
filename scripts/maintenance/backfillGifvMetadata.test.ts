import knex, { Knex } from 'knex'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getKnex } from '@/lib/database'
import { resolveAnimationMetadata } from '@/lib/services/medias/animationMetadata'

import { parseArgs, runBackfill } from './backfillGifvMetadata'

vi.mock('@/lib/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/database')>()),
  getKnex: vi.fn()
}))

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
  let testDb: Knex

  beforeEach(async () => {
    testDb = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })

    await testDb.schema.createTable('statuses', (t) => {
      t.string('id').primary()
      t.string('url')
      t.string('actorId')
    })

    await testDb.schema.createTable('attachments', (t) => {
      t.string('id').primary()
      t.string('statusId')
      t.string('actorId')
      t.string('mediaType')
      t.string('url')
      t.string('playbackType')
      t.string('thumbnailUrl')
      t.timestamp('createdAt').defaultTo(testDb.fn.now())
    })

    vi.mocked(getKnex).mockReturnValue(testDb)
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await testDb.destroy()
  })

  it('updates matching video attachments with resolved gifv metadata', async () => {
    await testDb('statuses').insert({
      id: 'stat-1',
      url: 'https://mastodon.social/@cheeaun/111000',
      actorId: 'https://mastodon.social/users/cheeaun'
    })

    await testDb('attachments').insert({
      id: 'att-1',
      statusId: 'stat-1',
      actorId: 'https://mastodon.social/users/cheeaun',
      mediaType: 'video/mp4',
      url: 'https://files.mastodon.social/video.mp4',
      playbackType: null,
      thumbnailUrl: null
    })

    vi.mocked(resolveAnimationMetadata).mockResolvedValueOnce({
      'https://files.mastodon.social/video.mp4': {
        playbackType: 'gifv',
        previewUrl: 'https://files.mastodon.social/preview.jpg'
      }
    })

    await runBackfill({ dryRun: false, batchSize: 10 })

    const updated = await testDb('attachments').where('id', 'att-1').first()
    expect(updated.playbackType).toBe('gifv')
    expect(updated.thumbnailUrl).toBe(
      'https://files.mastodon.social/preview.jpg'
    )
  })

  it('does not write changes in dry-run mode', async () => {
    await testDb('statuses').insert({
      id: 'stat-2',
      url: 'https://mastodon.social/@cheeaun/222000',
      actorId: 'https://mastodon.social/users/cheeaun'
    })

    await testDb('attachments').insert({
      id: 'att-2',
      statusId: 'stat-2',
      actorId: 'https://mastodon.social/users/cheeaun',
      mediaType: 'video/mp4',
      url: 'https://files.mastodon.social/video2.mp4',
      playbackType: null,
      thumbnailUrl: null
    })

    vi.mocked(resolveAnimationMetadata).mockResolvedValueOnce({
      'https://files.mastodon.social/video2.mp4': {
        playbackType: 'gifv',
        previewUrl: 'https://files.mastodon.social/preview2.jpg'
      }
    })

    await runBackfill({ dryRun: true, batchSize: 10 })

    const row = await testDb('attachments').where('id', 'att-2').first()
    expect(row.playbackType).toBeNull()
    expect(row.thumbnailUrl).toBeNull()
  })

  it('advances past failing attachments without infinite looping', async () => {
    await testDb('attachments').insert([
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

    vi.mocked(resolveAnimationMetadata)
      .mockRejectedValueOnce(new Error('Network failure'))
      .mockResolvedValueOnce({
        'https://files.mastodon.social/ok.mp4': {
          playbackType: 'video',
          previewUrl: null
        }
      })

    // Should complete cleanly without hanging
    await runBackfill({ dryRun: false, batchSize: 1 })

    const okRow = await testDb('attachments').where('id', 'att-ok').first()
    expect(okRow.playbackType).toBe('video')
  })
})
