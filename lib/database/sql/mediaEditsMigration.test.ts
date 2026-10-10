import knex, { Knex } from 'knex'

import * as migration from '@/migrations/20261010134810_add_media_edits'

describe('add media edits migration', () => {
  let database: Knex

  beforeEach(async () => {
    database = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })
    await database.schema.createTable('medias', (table) => {
      table.increments('id').primary()
      table.string('actorId')
      table.string('original')
    })
    await database('medias').insert({ actorId: 'actor', original: 'a.jpg' })
  })

  afterEach(async () => {
    await database.destroy()
  })

  it('adds the edit columns with an unedited default to existing rows', async () => {
    await migration.up(database)

    const [row] = await database('medias').select(
      'editRecipe',
      'editVersion',
      'editedAt',
      'editSaveId'
    )
    expect(row).toEqual({
      editRecipe: null,
      editVersion: 0,
      editedAt: null,
      editSaveId: null
    })
  })

  it('keeps one file per media and slot', async () => {
    await migration.up(database)
    const file = {
      mediaId: 1,
      actorId: 'actor',
      slot: 'original',
      path: 'a.jpg',
      bytes: 10,
      mimeType: 'image/jpeg',
      metaData: '{}'
    }

    await database('media_edit_files').insert({ id: 'one', ...file })
    await expect(
      database('media_edit_files').insert({ id: 'two', ...file })
    ).rejects.toThrow()
    await database('media_edit_files').insert({
      id: 'three',
      ...file,
      slot: 'superseded:x'
    })
    expect(await database('media_edit_files').count({ count: '*' })).toEqual([
      { count: 2 }
    ])
  })

  it('is safe to run twice and rolls back cleanly', async () => {
    await migration.up(database)
    await migration.up(database)

    await migration.down(database)

    expect(await database.schema.hasTable('media_edit_files')).toBeFalse()
    for (const column of [
      'editRecipe',
      'editVersion',
      'editedAt',
      'editSaveId'
    ]) {
      expect(await database.schema.hasColumn('medias', column)).toBeFalse()
    }
    expect(await database('medias').select('original')).toEqual([
      { original: 'a.jpg' }
    ])
  })
})
