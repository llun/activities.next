import knex, { Knex } from 'knex'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { createLegacyKnex } from '@/lib/database/testing/legacyKnex'
import * as migration from '@/migrations/20261012100000_attachments_media_id_integer_sqlite'

type TableInfoRow = {
  cid: number
  name: string
  type: string
  notnull: number
  dflt_value: string | null
  pk: number
}
type IndexListRow = { name: string; unique: number; origin: string }
type IndexInfoRow = { name: string }
type SqliteMasterRow = { name: string; sql: string | null }

// `attachments` as 20260207213000_add_attachments_media_id left it on SQLite,
// the way the schema dump spelled it before the migration.
const OLD_ATTACHMENTS_SQL =
  'CREATE TABLE `attachments` (`id` varchar(255), `statusId` varchar(255), `url` varchar(255), `mediaType` varchar(255), `type` varchar(255), `width` integer, `height` integer, `name` text, `createdAt` datetime default CURRENT_TIMESTAMP, `updatedAt` datetime default CURRENT_TIMESTAMP, `actorId` varchar(255), `mediaId` varchar(255), `blurhash` varchar(255) null, `focusX` float null, `focusY` float null, `thumbnailUrl` varchar(255) null, `playbackType` varchar(32) null, primary key (`id`))'
const ATTACHMENTS_INDEXES_SQL = [
  'CREATE INDEX `attachmentsIndex` on `attachments` (`statusId`, `createdAt`, `updatedAt`)',
  'CREATE INDEX `attachments_actorId_idx` on `attachments` (`actorId`)',
  'CREATE INDEX `attachments_mediaId_idx` on `attachments` (`mediaId`)'
]

// What each stored `mediaId` becomes: a whole number in 0..2147483647 (the
// bound the PostgreSQL migration used), however it is padded or spelled with
// an all-zero fraction, and NULL for anything else.
const MEDIA_IDS: Array<[stored: string | null, migrated: number | null]> = [
  ['12', 12],
  ['0012', 12],
  ['12.0', 12],
  ['12.000', 12],
  ['0', 0],
  ['2147483647', 2147483647],
  [null, null],
  ['2147483648', null],
  ['99999999999999999999', null],
  ['12.5', null],
  ['12.', null],
  ['1.0.0', null],
  ['abc', null],
  ['12abc', null],
  [' 12', null],
  ['12 ', null],
  ['-1', null],
  ['+1', null],
  ['1e3', null],
  ['0x10', null],
  ['', null]
]

describe('attachments mediaId integer migration', () => {
  let database: Knex

  const tableInfo = async (): Promise<TableInfoRow[]> =>
    database.raw('PRAGMA table_info(`attachments`)')

  // SQLite spells its own `integer` in capitals and leaves the others as
  // declared.
  const mediaIdType = async () =>
    (await tableInfo())
      .find(({ name }) => name === 'mediaId')
      ?.type.toLowerCase()

  const indexes = async () => {
    const list: IndexListRow[] = await database.raw(
      'PRAGMA index_list(`attachments`)'
    )
    const described: Record<string, string[]> = {}
    for (const { name } of list.sort((a, b) => a.name.localeCompare(b.name))) {
      const columns: IndexInfoRow[] = await database.raw(
        `PRAGMA index_info(\`${name}\`)`
      )
      described[name] = columns.map((column) => column.name)
    }
    return described
  }

  const mediaIds = async () => {
    const rows: Array<{ id: string; mediaId: unknown; kind: string }> =
      await database.raw(
        'SELECT id, mediaId, typeof(mediaId) AS kind FROM `attachments` ORDER BY id'
      )
    return rows
  }

  const insertRow = (id: string, mediaId: string | null) =>
    database.raw(
      'INSERT INTO `attachments` (`id`, `statusId`, `url`, `mediaType`, `type`, `width`, `height`, `name`, `createdAt`, `updatedAt`, `actorId`, `mediaId`, `blurhash`, `focusX`, `focusY`, `thumbnailUrl`, `playbackType`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        `status-${id}`,
        `https://media.test/${id}.jpg`,
        'image/jpeg',
        'Document',
        640,
        480,
        `name ${id}`,
        '2026-01-02 03:04:05',
        '2026-01-03 04:05:06',
        'https://media.test/users/alice',
        mediaId,
        'LKO2?U%2Tw=w]~RBVZRi};RPxuwH',
        0.25,
        -0.5,
        `https://media.test/${id}-thumb.jpg`,
        'gifv'
      ]
    )

  beforeEach(async () => {
    database = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })
    await database.raw(OLD_ATTACHMENTS_SQL)
    for (const sql of ATTACHMENTS_INDEXES_SQL) await database.raw(sql)
  })

  afterEach(async () => {
    await database.destroy()
  })

  it('starts from a varchar mediaId', async () => {
    expect(await mediaIdType()).toBe('varchar(255)')
  })

  it('stores mediaId as a nullable integer on up', async () => {
    await migration.up(database)

    const mediaId = (await tableInfo()).find(({ name }) => name === 'mediaId')
    expect(mediaId).toMatchObject({ type: 'INTEGER', notnull: 0, pk: 0 })
    expect(mediaId?.dflt_value).toBeNull()
  })

  it('keeps every other column, its default and the primary key', async () => {
    const before = await tableInfo()

    await migration.up(database)

    const after = await tableInfo()
    const withoutMediaIdType = (rows: TableInfoRow[]) =>
      rows.map((row) => (row.name === 'mediaId' ? { ...row, type: '' } : row))
    expect(withoutMediaIdType(after)).toEqual(withoutMediaIdType(before))
    expect(after.filter(({ pk }) => pk > 0).map(({ name }) => name)).toEqual([
      'id'
    ])
    expect(after.find(({ name }) => name === 'createdAt')?.dflt_value).toBe(
      'CURRENT_TIMESTAMP'
    )
    expect(after.find(({ name }) => name === 'updatedAt')?.dflt_value).toBe(
      'CURRENT_TIMESTAMP'
    )
  })

  it('keeps the table definition in the style of the schema dump', async () => {
    await migration.up(database)

    const [table]: SqliteMasterRow[] = await database.raw(
      "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name = 'attachments'"
    )
    expect(table.sql).toBe(
      OLD_ATTACHMENTS_SQL.replace('`mediaId` varchar(255)', '`mediaId` integer')
    )
  })

  it('keeps every index, re-created from its stored definition', async () => {
    const before = await indexes()
    expect(Object.keys(before).sort()).toEqual(
      [
        'attachmentsIndex',
        'attachments_actorId_idx',
        'attachments_mediaId_idx',
        'sqlite_autoindex_attachments_1'
      ].sort()
    )

    await migration.up(database)

    expect(await indexes()).toEqual(before)
    const stored: SqliteMasterRow[] = await database.raw(
      "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'attachments' AND sql IS NOT NULL ORDER BY name"
    )
    expect(stored.map(({ sql }) => sql).sort()).toEqual(
      [...ATTACHMENTS_INDEXES_SQL].sort()
    )
  })

  it('keeps an index added by a later migration too', async () => {
    await database.raw(
      'CREATE UNIQUE INDEX `attachments_url_unique` on `attachments` (`url`)'
    )

    await migration.up(database)

    expect(await indexes()).toHaveProperty('attachments_url_unique', ['url'])
    const insertUrl = (id: string) =>
      database.raw('INSERT INTO `attachments` (`id`, `url`) VALUES (?, ?)', [
        id,
        'https://media.test/same.jpg'
      ])
    await insertUrl('first')
    await expect(insertUrl('second')).rejects.toThrow(/UNIQUE/)
  })

  it('keeps the row count and every other value, and converts mediaId', async () => {
    for (const [index, [stored]] of MEDIA_IDS.entries()) {
      await insertRow(`attachment-${String(index).padStart(2, '0')}`, stored)
    }
    const before: Array<Record<string, unknown>> = await database.raw(
      'SELECT * FROM `attachments` ORDER BY id'
    )
    expect(before).toHaveLength(MEDIA_IDS.length)

    await migration.up(database)

    const after: Array<Record<string, unknown>> = await database.raw(
      'SELECT * FROM `attachments` ORDER BY id'
    )
    expect(after).toHaveLength(MEDIA_IDS.length)
    expect(after.map((row) => ({ ...row, mediaId: null }))).toEqual(
      before.map((row) => ({ ...row, mediaId: null }))
    )
    expect(after.map(({ mediaId }) => mediaId)).toEqual(
      MEDIA_IDS.map(([, migrated]) => migrated)
    )
    expect((await mediaIds()).map(({ kind }) => kind).sort()).toEqual(
      MEDIA_IDS.map(([, migrated]) =>
        migrated === null ? 'null' : 'integer'
      ).sort()
    )
  })

  it('migrates a table without rows', async () => {
    await migration.up(database)

    expect(await mediaIdType()).toBe('integer')
    expect(await mediaIds()).toEqual([])
  })

  it('stores integers and answers an integer comparison through the index', async () => {
    await insertRow('one', '7')
    await migration.up(database)
    await database.raw(
      'INSERT INTO `attachments` (`id`, `mediaId`) VALUES (?, ?)',
      ['two', 7]
    )

    const rows = await database('attachments').where('mediaId', 7).orderBy('id')
    expect(rows.map(({ id }) => id)).toEqual(['one', 'two'])
    const plan: Array<{ detail: string }> = await database.raw(
      'EXPLAIN QUERY PLAN SELECT id FROM `attachments` WHERE `mediaId` = ?',
      [7]
    )
    expect(plan.map(({ detail }) => detail).join('\n')).toContain(
      'USING INDEX attachments_mediaId_idx (mediaId=?)'
    )
  })

  it('leaves no temporary table behind and is safe to run twice', async () => {
    await insertRow('one', '7')

    await migration.up(database)
    const first = await mediaIds()
    await migration.up(database)

    expect(await mediaIds()).toEqual(first)
    const tables: SqliteMasterRow[] = await database.raw(
      "SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name"
    )
    expect(tables.map(({ name }) => name)).toEqual(['attachments'])
  })

  it('refuses to rebuild a table another table references, and changes nothing', async () => {
    await database.raw(
      'CREATE TABLE `attachment_notes` (`id` varchar(255) primary key, `attachmentId` varchar(255), foreign key(`attachmentId`) references `attachments`(`id`) on delete cascade)'
    )
    await insertRow('one', '7')
    await database.raw(
      "INSERT INTO `attachment_notes` (`id`, `attachmentId`) VALUES ('note', 'one')"
    )

    await expect(migration.up(database)).rejects.toThrow(
      'Cannot rebuild attachments: referenced by attachment_notes'
    )

    expect(await mediaIdType()).toBe('varchar(255)')
    expect(await mediaIds()).toEqual([
      { id: 'one', mediaId: '7', kind: 'text' }
    ])
    expect(await database('attachment_notes').count({ count: '*' })).toEqual([
      { count: 1 }
    ])
  })

  it.each([
    [
      'a view',
      'CREATE VIEW `attachment_names` AS SELECT `id`, `name` FROM `attachments`',
      'attachment_names'
    ],
    [
      'a trigger',
      'CREATE TRIGGER `attachments_touch` AFTER UPDATE ON `attachments` BEGIN SELECT 1; END',
      'attachments_touch'
    ],
    [
      'a trigger on another table',
      'CREATE TRIGGER `notes_touch` AFTER INSERT ON `notes` BEGIN DELETE FROM `attachments` WHERE `id` = NEW.`id`; END',
      'notes_touch'
    ]
  ])(
    'refuses to rebuild a table that %s uses, and changes nothing',
    async (_, sql, name) => {
      await database.raw('CREATE TABLE `notes` (`id` varchar(255))')
      await database.raw(sql)
      await insertRow('one', '7')

      await expect(migration.up(database)).rejects.toThrow(
        `Cannot rebuild attachments: used by ${name}`
      )

      expect(await mediaIdType()).toBe('varchar(255)')
      expect(await mediaIds()).toEqual([
        { id: 'one', mediaId: '7', kind: 'text' }
      ])
      const objects: SqliteMasterRow[] = await database.raw(
        "SELECT name, sql FROM sqlite_master WHERE type IN ('trigger', 'view')"
      )
      expect(objects.map((object) => object.name)).toEqual([name])
    }
  )

  it('rolls the rebuild back when it fails part-way', async () => {
    // Two spellings of one id are distinct as text but one row id once
    // converted, so re-creating this index fails after the rows were copied and
    // the old table dropped.
    await database.raw(
      'CREATE UNIQUE INDEX `attachments_mediaId_unique` on `attachments` (`mediaId`)'
    )
    await insertRow('one', '12')
    await insertRow('two', '012')

    await expect(migration.up(database)).rejects.toThrow(/UNIQUE/)

    expect(await mediaIdType()).toBe('varchar(255)')
    expect(await mediaIds()).toEqual([
      { id: 'one', mediaId: '12', kind: 'text' },
      { id: 'two', mediaId: '012', kind: 'text' }
    ])
    expect(Object.keys(await indexes())).toEqual(
      expect.arrayContaining([
        'attachmentsIndex',
        'attachments_actorId_idx',
        'attachments_mediaId_idx',
        'attachments_mediaId_unique'
      ])
    )
    const tables: SqliteMasterRow[] = await database.raw(
      "SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name"
    )
    expect(tables.map(({ name }) => name)).toEqual(['attachments'])
  })

  describe('down', () => {
    it('restores the varchar mediaId, the other columns and every index', async () => {
      const columnsBefore = await tableInfo()
      const indexesBefore = await indexes()
      await insertRow('numeric', '12')
      await insertRow('none', null)
      await migration.up(database)

      await migration.down(database)

      expect(await tableInfo()).toEqual(columnsBefore)
      expect(await indexes()).toEqual(indexesBefore)
      const [table]: SqliteMasterRow[] = await database.raw(
        "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name = 'attachments'"
      )
      expect(table.sql).toBe(OLD_ATTACHMENTS_SQL)
      expect(await mediaIds()).toEqual([
        { id: 'none', mediaId: null, kind: 'null' },
        { id: 'numeric', mediaId: '12', kind: 'text' }
      ])
    })

    it('does nothing when mediaId is not an integer', async () => {
      await insertRow('one', '7')

      await migration.down(database)

      expect(await mediaIdType()).toBe('varchar(255)')
      expect(await mediaIds()).toEqual([
        { id: 'one', mediaId: '7', kind: 'text' }
      ])
    })

    it('can be followed by up again', async () => {
      await insertRow('one', '7')

      await migration.up(database)
      await migration.down(database)
      await migration.up(database)

      expect(await mediaIdType()).toBe('integer')
      expect(await mediaIds()).toEqual([
        { id: 'one', mediaId: 7, kind: 'integer' }
      ])
    })
  })
})

// The test databases are built from the committed schema dumps, which already
// carry the migrated column. PostgreSQL converted it in
// 20260207223000_fix_attachments_media_id_type, so the SQLite migration changes
// nothing there.
describe('attachments mediaId on the test database', () => {
  const testDb = createTestDatabase()

  beforeAll(async () => {
    await testDb.prepare()
    await testDb.database.migrate()
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  it('is a nullable integer in the schema dump', async () => {
    const tables = await testDb.db.introspection.getTables()
    const attachments = tables.find(({ name }) => name === 'attachments')
    const mediaId = attachments?.columns.find(({ name }) => name === 'mediaId')

    expect(mediaId?.dataType.toLowerCase()).toBe(
      testDb.backend === 'pg' ? 'int4' : 'integer'
    )
    expect(mediaId?.isNullable).toBeTrue()
  })

  it.runIf(testDb.backend === 'pg')(
    'is a no-op on PostgreSQL in both directions',
    async () => {
      // The migration runs on a Knex instance on the same database.
      const legacy = createLegacyKnex('pg')
      try {
        const columnType = async () => {
          const result = await legacy.raw(
            "SELECT data_type FROM information_schema.columns WHERE table_name = 'attachments' AND column_name = 'mediaId'"
          )
          return result.rows[0]?.data_type
        }
        await legacy('attachments').insert([
          { id: 'one', mediaId: 12 },
          { id: 'two', mediaId: null }
        ])

        await migration.up(legacy)
        expect(await columnType()).toBe('integer')
        await migration.down(legacy)
        expect(await columnType()).toBe('integer')

        const rows = await legacy('attachments').orderBy('id')
        expect(rows.map(({ id, mediaId }) => ({ id, mediaId }))).toEqual([
          { id: 'one', mediaId: 12 },
          { id: 'two', mediaId: null }
        ])
        const indexes = await legacy.raw(
          "SELECT indexname FROM pg_indexes WHERE tablename = 'attachments'"
        )
        expect(
          indexes.rows.map(({ indexname }: { indexname: string }) => indexname)
        ).toContain('attachments_mediaId_idx')
      } finally {
        await legacy.destroy()
      }
    }
  )
})
