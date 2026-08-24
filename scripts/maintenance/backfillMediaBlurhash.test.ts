import knex, { Knex } from 'knex'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { backfillAttachments, parseArgs } from './backfillMediaBlurhash'

describe('backfillMediaBlurhash parseArgs', () => {
  it('parses flags correctly', () => {
    expect(parseArgs([])).toEqual({
      batchSize: 50,
      dryRun: false,
      force: false
    })

    expect(parseArgs(['--dry-run', '--force', '--batch-size=100'])).toEqual({
      batchSize: 100,
      dryRun: true,
      force: true
    })

    expect(parseArgs(['--batch-size', '25'])).toEqual({
      batchSize: 25,
      dryRun: false,
      force: false
    })
  })
})

describe('backfillMediaBlurhash execution', () => {
  let db: Knex

  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })

    await db.schema.createTable('medias', (table) => {
      table.increments('id').primary()
      table.string('actorId')
      table.string('original')
      table.integer('originalBytes')
      table.string('originalMimeType')
      table.string('thumbnail')
      table.integer('thumbnailBytes')
      table.string('thumbnailMimeType')
      table.float('focusX').nullable()
      table.float('focusY').nullable()
      table.string('blurhash').nullable()
    })

    await db.schema.createTable('attachments', (table) => {
      table.string('id').primary()
      table.string('statusId')
      table.string('actorId')
      table.string('mediaId').nullable()
      table.string('mediaType')
      table.string('url')
      table.integer('width')
      table.integer('height')
      table.string('name')
      table.string('blurhash').nullable()
      table.float('focusX').nullable()
      table.float('focusY').nullable()
      table.string('thumbnailUrl').nullable()
      table.timestamp('createdAt').defaultTo(db.fn.now())
      table.timestamp('updatedAt').defaultTo(db.fn.now())
    })
  })

  afterEach(async () => {
    await db.destroy()
  })

  it('backfills attachments linked to media rows', async () => {
    await db('medias').insert({
      id: 1,
      actorId: 'actor-1',
      original: 'orig.jpg',
      originalBytes: 100,
      originalMimeType: 'image/jpeg',
      blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4',
      focusX: 0.25,
      focusY: -0.5
    })

    await db('attachments').insert({
      id: 'att-1',
      statusId: 'status-1',
      actorId: 'actor-1',
      mediaId: '1',
      mediaType: 'image/jpeg',
      url: 'https://example.com/api/v1/files/orig.jpg',
      blurhash: null,
      focusX: null,
      focusY: null
    })

    const mockStorage = {
      getFile: vi.fn().mockResolvedValue(null)
    } as any

    await backfillAttachments(db, mockStorage, {
      batchSize: 50,
      dryRun: false,
      force: false
    })

    const updated = await db('attachments').where('id', 'att-1').first()
    expect(updated.blurhash).toBe('L6PZfSi_.AyE_3t7t7R**0o#DgR4')
    expect(updated.focusX).toBe(0.25)
    expect(updated.focusY).toBe(-0.5)
  })
})
