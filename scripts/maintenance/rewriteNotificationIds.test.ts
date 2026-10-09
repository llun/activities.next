import knex from 'knex'

import { isPublicId } from '@/lib/utils/publicId'

import { runRewrite } from './rewriteNotificationIds'

describe('rewriteNotificationIds runRewrite', () => {
  let database: knex.Knex

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    database = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })
    await database.schema.createTable('notifications', (table) => {
      table.string('id').primary()
      table.string('actorId').notNullable()
      table.datetime('createdAt')
    })
    await database.schema.createTable('markers', (table) => {
      table.string('id').primary()
      table.string('actorId').notNullable()
      table.string('timeline').notNullable()
      table.text('lastReadId').notNullable()
      table.integer('version').notNullable().defaultTo(1)
      table.datetime('updatedAt').notNullable().defaultTo(database.fn.now())
    })
    // A row the previous build wrote during the rollout, and the marker an
    // id-ordering client moved onto it.
    await database('notifications').insert({
      id: 'f0000000-0000-4000-8000-000000000000',
      actorId: 'https://llun.test/users/a',
      createdAt: Date.UTC(2026, 9, 9)
    })
    await database('markers').insert({
      id: 'marker',
      actorId: 'https://llun.test/users/a',
      timeline: 'notifications',
      lastReadId: 'f0000000-0000-4000-8000-000000000000'
    })
  })

  afterEach(async () => {
    await database.destroy()
    vi.restoreAllMocks()
  })

  it('exits 1 on a dry run with leftovers and writes nothing', async () => {
    await expect(
      runRewrite(database, { dryRun: true, batchSize: 500 })
    ).resolves.toBe(1)

    const [row] = await database('notifications').select('id')
    expect(row.id).toBe('f0000000-0000-4000-8000-000000000000')
  })

  it('counts an orphan notifications marker toward a dry-run exit 1', async () => {
    await database('notifications').delete()
    await database('markers').update({
      lastReadId: 'e0000000-0000-4000-8000-000000000000'
    })

    await expect(
      runRewrite(database, { dryRun: true, batchSize: 500 })
    ).resolves.toBe(1)
    await expect(
      runRewrite(database, { dryRun: false, batchSize: 500 })
    ).resolves.toBe(0)
    const [marker] = await database('markers').select('lastReadId')
    expect(isPublicId(marker.lastReadId)).toBe(true)
  })

  it('rewrites the leftovers, repoints the marker and exits 0', async () => {
    await expect(
      runRewrite(database, { dryRun: false, batchSize: 500 })
    ).resolves.toBe(0)

    const [row] = await database('notifications').select('id')
    expect(isPublicId(row.id)).toBe(true)
    const [marker] = await database('markers').select('lastReadId', 'version')
    expect(marker.lastReadId).toBe(row.id)
    expect(marker.version).toBe(2)

    // A second run over a clean table is a no-op that still passes.
    await expect(
      runRewrite(database, { dryRun: false, batchSize: 500 })
    ).resolves.toBe(0)
  })
})
