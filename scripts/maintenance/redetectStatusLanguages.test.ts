import knex, { Knex } from 'knex'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { StatusDetectedLanguageSQLDatabaseMixin } from '@/lib/database/sql/statusDetectedLanguage'
import { Database } from '@/lib/database/types'

import {
  DEFAULT_BATCH_SIZE,
  parseArgs,
  redetectStatusLanguages
} from './redetectStatusLanguages'

describe('redetectStatusLanguages parseArgs', () => {
  it('defaults to live run with default batch size and no filters', () => {
    expect(parseArgs([])).toEqual({
      dryRun: false,
      batchSize: DEFAULT_BATCH_SIZE,
      resumeFrom: undefined,
      limit: undefined
    })
  })

  it('accepts bare, inline, and space-separated boolean flags', () => {
    expect(parseArgs(['--dry-run'])).toEqual({
      dryRun: true,
      batchSize: DEFAULT_BATCH_SIZE,
      resumeFrom: undefined,
      limit: undefined
    })
    expect(parseArgs(['--dry-run=false'])).toEqual({
      dryRun: false,
      batchSize: DEFAULT_BATCH_SIZE,
      resumeFrom: undefined,
      limit: undefined
    })
    expect(parseArgs(['--dry-run', 'true'])).toEqual({
      dryRun: true,
      batchSize: DEFAULT_BATCH_SIZE,
      resumeFrom: undefined,
      limit: undefined
    })
  })

  it('accepts batch-size inline or space-separated', () => {
    expect(parseArgs(['--batch-size', '50'])).toEqual({
      dryRun: false,
      batchSize: 50,
      resumeFrom: undefined,
      limit: undefined
    })
    expect(parseArgs(['--batch-size=100'])).toEqual({
      dryRun: false,
      batchSize: 100,
      resumeFrom: undefined,
      limit: undefined
    })
  })

  it('accepts resume-from inline or space-separated', () => {
    expect(parseArgs(['--resume-from', 'status-abc'])).toEqual({
      dryRun: false,
      batchSize: DEFAULT_BATCH_SIZE,
      resumeFrom: 'status-abc',
      limit: undefined
    })
    expect(parseArgs(['--resume-from=status-xyz'])).toEqual({
      dryRun: false,
      batchSize: DEFAULT_BATCH_SIZE,
      resumeFrom: 'status-xyz',
      limit: undefined
    })
  })

  it('accepts limit inline or space-separated', () => {
    expect(parseArgs(['--limit', '10'])).toEqual({
      dryRun: false,
      batchSize: DEFAULT_BATCH_SIZE,
      resumeFrom: undefined,
      limit: 10
    })
    expect(parseArgs(['--limit=25'])).toEqual({
      dryRun: false,
      batchSize: DEFAULT_BATCH_SIZE,
      resumeFrom: undefined,
      limit: 25
    })
  })

  it.each([
    { description: 'a non-flag argument', args: ['status-id'] },
    { description: 'an unknown flag', args: ['--unknown'] },
    {
      description: 'an invalid boolean flag value',
      args: ['--dry-run', 'invalid']
    },
    { description: 'a zero batch size', args: ['--batch-size', '0'] },
    { description: 'a negative batch size', args: ['--batch-size', '-5'] },
    { description: 'a non-integer batch size', args: ['--batch-size', '1.5'] },
    { description: 'a batch size with no value', args: ['--batch-size'] },
    { description: 'a resume-from with no value', args: ['--resume-from'] },
    { description: 'a zero limit', args: ['--limit', '0'] },
    { description: 'a negative limit', args: ['--limit', '-10'] }
  ])('rejects $description', ({ args }) => {
    expect(() => parseArgs(args)).toThrow()
  })
})

describe('redetectStatusLanguages execution', () => {
  let db: Knex
  let database: Database
  const now = new Date('2026-09-15T12:00:00.000Z')

  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })

    await db.schema.createTable('statuses', (table) => {
      table.string('id').primary()
      table.string('type')
      table.text('text')
      table.string('language')
      table.timestamp('createdAt').defaultTo(db.fn.now())
      table.timestamp('updatedAt').defaultTo(db.fn.now())
    })

    await db.schema.createTable('status_detected_languages', (table) => {
      table.string('statusId').primary()
      table.string('language')
      table.float('confidence')
      table.timestamp('createdAt').defaultTo(db.fn.now())
      table.timestamp('updatedAt').defaultTo(db.fn.now())
    })

    database = {
      ...StatusDetectedLanguageSQLDatabaseMixin(db)
    } as unknown as Database
  })

  afterEach(async () => {
    await db.destroy()
  })

  it('newly detects language for a status without prior detection record', async () => {
    // Dutch headline with mathematical bold characters
    const styledDutch =
      '𝐍𝐢𝐞𝐮𝐰𝐬 𝐯𝐚𝐧𝐝𝐚𝐚𝐠: 𝐝𝐞 𝐫𝐞𝐠𝐞𝐫𝐢𝐧𝐠 𝐡𝐞𝐞𝐟𝐭 𝐞𝐞𝐧 𝐧𝐢𝐞𝐮𝐰 𝐛𝐞𝐬𝐥𝐮𝐢𝐭 𝐠𝐞𝐧𝐨𝐦𝐞𝐧 𝐨𝐯𝐞𝐫 𝐝𝐞 𝐞𝐧𝐞𝐫𝐠𝐢𝐞𝐭𝐫𝐚𝐧𝐬𝐢𝐭𝐢𝐞.'
    await db('statuses').insert({
      id: 'status-1',
      type: 'Note',
      text: styledDutch,
      language: 'en',
      createdAt: now,
      updatedAt: now
    })

    const result = await redetectStatusLanguages({
      database,
      knexClient: db
    })

    expect(result.scanned).toBe(1)
    expect(result.newlyDetected).toBe(1)
    expect(result.updated).toBe(0)
    expect(result.cleared).toBe(0)
    expect(result.unchanged).toBe(0)

    const record = await db('status_detected_languages')
      .where('statusId', 'status-1')
      .first()
    expect(record?.language).toBe('nl')
  })

  it('updates detected language when re-detection differs from stored record', async () => {
    const styledDutch =
      '𝐍𝐢𝐞𝐮𝐰𝐬 𝐯𝐚𝐧𝐝𝐚𝐚𝐠: 𝐝𝐞 𝐫𝐞𝐠𝐞𝐫𝐢𝐧𝐠 𝐡𝐞𝐞𝐟𝐭 𝐞𝐞𝐧 𝐧𝐢𝐞𝐮𝐰 𝐛𝐞𝐬𝐥𝐮𝐢𝐭 𝐠𝐞𝐧𝐨𝐦𝐞𝐧 𝐨𝐯𝐞𝐫 𝐝𝐞 𝐞𝐧𝐞𝐫𝐠𝐢𝐞𝐭𝐫𝐚𝐧𝐬𝐢𝐭𝐢𝐞.'
    await db('statuses').insert({
      id: 'status-2',
      type: 'Note',
      text: styledDutch,
      language: 'en',
      createdAt: now,
      updatedAt: now
    })
    await db('status_detected_languages').insert({
      statusId: 'status-2',
      language: 'de',
      confidence: 0.5,
      createdAt: now,
      updatedAt: now
    })

    const result = await redetectStatusLanguages({
      database,
      knexClient: db
    })

    expect(result.scanned).toBe(1)
    expect(result.newlyDetected).toBe(0)
    expect(result.updated).toBe(1)

    const record = await db('status_detected_languages')
      .where('statusId', 'status-2')
      .first()
    expect(record?.language).toBe('nl')
  })

  it('leaves unchanged records alone when detection matches stored record', async () => {
    const dutch =
      'Nieuws vandaag: de regering heeft een nieuw besluit genomen over de energietransitie.'
    await db('statuses').insert({
      id: 'status-3',
      type: 'Note',
      text: dutch,
      language: 'nl',
      createdAt: now,
      updatedAt: now
    })
    await db('status_detected_languages').insert({
      statusId: 'status-3',
      language: 'nl',
      confidence: 0.9,
      createdAt: now,
      updatedAt: now
    })

    const result = await redetectStatusLanguages({
      database,
      knexClient: db
    })

    expect(result.scanned).toBe(1)
    expect(result.unchanged).toBe(1)
    expect(result.newlyDetected).toBe(0)
    expect(result.updated).toBe(0)
    expect(result.cleared).toBe(0)
  })

  it('clears detected language when content is too short or inconclusive', async () => {
    await db('statuses').insert({
      id: 'status-4',
      type: 'Note',
      text: 'hi', // too short (< 20 chars)
      language: 'en',
      createdAt: now,
      updatedAt: now
    })
    await db('status_detected_languages').insert({
      statusId: 'status-4',
      language: 'en',
      confidence: 0.5,
      createdAt: now,
      updatedAt: now
    })

    const result = await redetectStatusLanguages({
      database,
      knexClient: db
    })

    expect(result.scanned).toBe(1)
    expect(result.cleared).toBe(1)

    const record = await db('status_detected_languages')
      .where('statusId', 'status-4')
      .first()
    expect(record).toBeUndefined()
  })

  it('in dry-run mode, computes stats without writing to database', async () => {
    const styledDutch =
      '𝐍𝐢𝐞𝐮𝐰𝐬 𝐯𝐚𝐧𝐝𝐚𝐚𝐠: 𝐝𝐞 𝐫𝐞𝐠𝐞𝐫𝐢𝐧𝐠 𝐡𝐞𝐞𝐟𝐭 𝐞𝐞𝐧 𝐧𝐢𝐞𝐮𝐰 𝐛𝐞𝐬𝐥𝐮𝐢𝐭 𝐠𝐞𝐧𝐨𝐦𝐞𝐧 𝐨𝐯𝐞𝐫 𝐝𝐞 𝐞𝐧𝐞𝐫𝐠𝐢𝐞𝐭𝐫𝐚𝐧𝐬𝐢𝐭𝐢𝐞.'
    await db('statuses').insert({
      id: 'status-dry',
      type: 'Note',
      text: styledDutch,
      language: 'en',
      createdAt: now,
      updatedAt: now
    })

    const result = await redetectStatusLanguages({
      database,
      knexClient: db,
      dryRun: true
    })

    expect(result.scanned).toBe(1)
    expect(result.newlyDetected).toBe(1)

    const record = await db('status_detected_languages')
      .where('statusId', 'status-dry')
      .first()
    expect(record).toBeUndefined()
  })

  it('skips writing when status.updatedAt has changed concurrently', async () => {
    const styledDutch =
      '𝐍𝐢𝐞𝐮𝐰𝐬 𝐯𝐚𝐧𝐝𝐚𝐚𝐠: 𝐝𝐞 𝐫𝐞𝐠𝐞𝐫𝐢𝐧𝐠 𝐡𝐞𝐞𝐟𝐭 𝐞𝐞𝐧 𝐧𝐢𝐞𝐮𝐰 𝐛𝐞𝐬𝐥𝐮𝐢𝐭 𝐠𝐞𝐧𝐨𝐦𝐞𝐧 𝐨𝐯𝐞𝐫 𝐝𝐞 𝐞𝐧𝐞𝐫𝐠𝐢𝐞𝐭𝐫𝐚𝐧𝐬𝐢𝐭𝐢𝐞.'
    await db('statuses').insert({
      id: 'status-concurrent',
      type: 'Note',
      text: styledDutch,
      language: 'en',
      createdAt: now,
      updatedAt: now
    })

    const setSpy = vi.spyOn(database, 'setDetectedLanguage')

    // Wrap knex query for statuses to update updatedAt concurrently
    // after the initial batch select resolves
    let initialSelectDone = false
    const originalQuery = db.queryBuilder
    const customKnex = new Proxy(db, {
      apply(target, thisArg, argArray) {
        const qb = Reflect.apply(target, thisArg, argArray)
        if (argArray[0] === 'statuses') {
          const origThen = qb.then.bind(qb)
          qb.then = function (onfulfilled: any, onrejected: any) {
            return origThen((val: any) => {
              if (
                Array.isArray(val) &&
                val.some((r) => r.id === 'status-concurrent') &&
                !initialSelectDone
              ) {
                initialSelectDone = true
                // Concurrently update status-concurrent in DB
                db('statuses')
                  .where('id', 'status-concurrent')
                  .update({ updatedAt: new Date(now.getTime() + 50_000) })
                  .then(() => onfulfilled(val), onrejected)
                return
              }
              return onfulfilled ? onfulfilled(val) : val
            }, onrejected)
          }
        }
        return qb
      }
    })

    const result = await redetectStatusLanguages({
      database,
      knexClient: customKnex
    })

    expect(result.scanned).toBe(1)
    expect(result.skippedConcurrent).toBe(1)
    expect(result.newlyDetected).toBe(0)
    expect(setSpy).not.toHaveBeenCalled()
  })

  it('supports pagination with batchSize, resumeFrom, and limit', async () => {
    const dutch1 =
      'Eerste Nederlandse testzin met voldoende lengte voor detectie.'
    const dutch2 =
      'Tweede Nederlandse testzin met voldoende lengte voor detectie.'
    const dutch3 =
      'Derde Nederlandse testzin met voldoende lengte voor detectie.'

    await db('statuses').insert([
      {
        id: 'status-01',
        type: 'Note',
        text: dutch1,
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'status-02',
        type: 'Note',
        text: dutch2,
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'status-03',
        type: 'Note',
        text: dutch3,
        createdAt: now,
        updatedAt: now
      }
    ])

    // Process first 2
    const pass1 = await redetectStatusLanguages({
      database,
      knexClient: db,
      batchSize: 1,
      limit: 2
    })
    expect(pass1.scanned).toBe(2)
    expect(pass1.lastProcessedId).toBe('status-02')

    // Resume from status-02
    const pass2 = await redetectStatusLanguages({
      database,
      knexClient: db,
      batchSize: 1,
      resumeFrom: 'status-02'
    })
    expect(pass2.scanned).toBe(1)
    expect(pass2.lastProcessedId).toBe('status-03')
  })

  it('is idempotent on subsequent runs', async () => {
    const dutch =
      'Dit is een Nederlandse tekst die lang genoeg is voor taaldetectie.'
    await db('statuses').insert({
      id: 'status-idem',
      type: 'Note',
      text: dutch,
      createdAt: now,
      updatedAt: now
    })

    const run1 = await redetectStatusLanguages({
      database,
      knexClient: db
    })
    expect(run1.newlyDetected).toBe(1)

    const run2 = await redetectStatusLanguages({
      database,
      knexClient: db
    })
    expect(run2.newlyDetected).toBe(0)
    expect(run2.updated).toBe(0)
    expect(run2.cleared).toBe(0)
    expect(run2.unchanged).toBe(1)
  })

  it('skips non-translatable status types like Announce', async () => {
    await db('statuses').insert({
      id: 'status-boost',
      type: 'Announce',
      text: 'Dit is een boost van een status die niet direct gedetecteerd moet worden.',
      createdAt: now,
      updatedAt: now
    })

    const result = await redetectStatusLanguages({
      database,
      knexClient: db
    })
    expect(result.scanned).toBe(0)
  })
})
