import { sql } from 'kysely'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'

// Schema facts the reference dumps (migrations/schema.sql,
// migrations/schema.sqlite.sql) must keep, read from a test database built
// from them, on SQLite and, under TEST_DATABASE_TYPE=pg, PostgreSQL. A query
// that reads the same rows with or without one of these indexes, or a delete
// that a foreign key no longer guards, passes every result-based test, so
// these read the definitions themselves. A migration that changes one of them
// on purpose changes the expectation here in the same pull request.
describe('schema invariants', () => {
  const testDb = createTestDatabase()
  const { database, db } = testDb

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  type IndexDefinition = { table: string; unique: boolean; columns: string[] }

  // An index's column list without quoting, casts or schema qualifiers, so
  // both backends read the same: `lower((username)::text)` on PostgreSQL and
  // `lower("username")` on SQLite are both `lower(username)`.
  const normalizeIndexColumn = (column: string) =>
    column
      .trim()
      .replace(/[`"]/g, '')
      .replace(/::[a-z ]+/gi, '')
      .replace(/\(\(([^()]*)\)\)/g, '($1)')

  const parseIndexDefinition = (definition: string): IndexDefinition => {
    const on = /\son\s+(\S+)\s+(?:using\s+\w+\s+)?\(/i.exec(definition)
    if (!on) throw new Error(`Cannot read the index definition ${definition}`)
    const columns: string[] = []
    let depth = 0
    let current = ''
    for (const char of definition.slice(on.index + on[0].length)) {
      if (char === '(') depth += 1
      if (char === ')') {
        if (depth === 0) break
        depth -= 1
      }
      if (char === ',' && depth === 0) {
        columns.push(current)
        current = ''
        continue
      }
      current += char
    }
    columns.push(current)
    return {
      table: on[1].replace(/[`"]/g, '').replace(/^public\./, ''),
      unique: /^create unique index/i.test(definition.trim()),
      columns: columns.map(normalizeIndexColumn)
    }
  }

  const getIndexDefinitionText = async (name: string) => {
    if (testDb.backend === 'pg') {
      const { rows } = await sql<{ definition: string }>`
        select indexdef as definition from pg_indexes
        where indexname = ${name} and schemaname = current_schema()
      `.execute(db)
      return rows[0]?.definition ?? null
    }
    const { rows } = await sql<{ definition: string | null }>`
      select sql as definition from sqlite_master
      where type = 'index' and name = ${name}
    `.execute(db)
    return rows[0]?.definition ?? null
  }

  const getIndex = async (name: string) => {
    const definition = await getIndexDefinitionText(name)
    return definition === null ? null : parseIndexDefinition(definition)
  }

  type ForeignKey = {
    table: string
    from: string
    references: string
    to: string
    onDelete: string
  }

  const PG_DELETE_RULES: Record<string, string> = {
    a: 'NO ACTION',
    c: 'CASCADE',
    d: 'SET DEFAULT',
    n: 'SET NULL',
    r: 'RESTRICT'
  }

  // Every foreign key that references `table`, sorted by referencing table.
  const getForeignKeysTo = async (table: string): Promise<ForeignKey[]> => {
    if (testDb.backend === 'pg') {
      const { rows } = await sql<
        Omit<ForeignKey, 'onDelete'> & { rule: string }
      >`
        select source.relname as "table", source_column.attname as "from",
          target.relname as "references", target_column.attname as "to",
          constraint_row.confdeltype as rule
        from pg_constraint constraint_row
        join pg_class source on source.oid = constraint_row.conrelid
        join pg_class target on target.oid = constraint_row.confrelid
        join pg_attribute source_column
          on source_column.attrelid = constraint_row.conrelid
          and source_column.attnum = constraint_row.conkey[1]
        join pg_attribute target_column
          on target_column.attrelid = constraint_row.confrelid
          and target_column.attnum = constraint_row.confkey[1]
        where constraint_row.contype = 'f' and target.relname = ${table}
          and pg_catalog.pg_table_is_visible(source.oid)
      `.execute(db)
      return rows
        .map(({ rule, ...foreignKey }) => ({
          ...foreignKey,
          onDelete: PG_DELETE_RULES[rule] ?? rule
        }))
        .sort((a, b) => a.table.localeCompare(b.table))
    }
    const { rows } = await sql<ForeignKey>`
      select tables.name as "table", foreign_key."from" as "from",
        foreign_key."table" as "references", foreign_key."to" as "to",
        foreign_key.on_delete as "onDelete"
      from sqlite_master tables
      join pragma_foreign_key_list(tables.name) foreign_key
      where tables.type = 'table' and foreign_key."table" = ${table}
    `.execute(db)
    return [...rows].sort((a, b) => a.table.localeCompare(b.table))
  }

  const getColumn = async (table: string, column: string) => {
    const tables = await db.introspection.getTables()
    return tables
      .find(({ name }) => name === table)
      ?.columns.find(({ name }) => name === column)
  }

  describe('indexes', () => {
    // Each reads a name and the columns in their order: a column moved inside
    // an index can leave a query that constrains only its leading columns
    // without an index condition.
    it.each<[string, IndexDefinition]>([
      [
        'medias_actorId_sortAt_id_idx',
        {
          table: 'medias',
          unique: false,
          columns: ['actorId', 'sortAt', 'id']
        }
      ],
      // getRebloggedBy constrains `type` and `originalStatusId` but not
      // `actorId`, so `originalStatusId` must come second.
      [
        'statuses_announce_original_actor_idx',
        {
          table: 'statuses',
          unique: false,
          columns: ['type', 'originalStatusId', 'actorId']
        }
      ],
      // The case-insensitive username lookup (findActorRowByUsername). Not
      // unique: actors that differ only by case may already exist.
      [
        'actors_lower_username_domain_idx',
        {
          table: 'actors',
          unique: false,
          columns: ['lower(username)', 'domain']
        }
      ],
      [
        'actors_username_domain_unique',
        { table: 'actors', unique: true, columns: ['username', 'domain'] }
      ],
      // The handle ledger: at most one row per folded handle across every
      // actor, current or retired, so a handle is reserved exactly once.
      [
        'actor_handles_lower_username_domain_unique',
        {
          table: 'actor_handles',
          unique: true,
          columns: ['lower(username)', 'domain']
        }
      ],
      // A handle's history and its rename cooldown read by actor, newest
      // replacement first.
      [
        'actor_handles_actorId_replacedAt_idx',
        {
          table: 'actor_handles',
          unique: false,
          columns: ['actorId', 'replacedAt']
        }
      ],
      // GET /api/v1/favourites pages `likes` by actor, newest first.
      [
        'likes_actor_created_at_status_idx',
        {
          table: 'likes',
          unique: false,
          columns: ['actorId', 'createdAt', 'statusId']
        }
      ],
      [
        'accounts_email_unique',
        { table: 'accounts', unique: true, columns: ['email'] }
      ],
      [
        'accountsIndex',
        {
          table: 'accounts',
          unique: false,
          columns: ['email', 'createdAt', 'updatedAt']
        }
      ],
      [
        'verificationCodeIndex',
        { table: 'accounts', unique: false, columns: ['verificationCode'] }
      ],
      [
        'passwordResetCodeIndex',
        { table: 'accounts', unique: false, columns: ['passwordResetCode'] }
      ],
      [
        'actors_domain_last_status_at_idx',
        { table: 'actors', unique: false, columns: ['domain', 'lastStatusAt'] }
      ],
      [
        'actors_publicid_unique',
        { table: 'actors', unique: true, columns: ['publicId'] }
      ],
      [
        'statuses_publicid_unique',
        { table: 'statuses', unique: true, columns: ['publicId'] }
      ],
      [
        'statusesReplyHashIndex',
        { table: 'statuses', unique: false, columns: ['replyHash'] }
      ],
      [
        'bookmarks_actor_source_status',
        {
          table: 'bookmarks',
          unique: false,
          columns: ['actorId', 'sourceStatusId']
        }
      ],
      // The app registration rate limit counts recent clients by reference.
      [
        'oauth_client_reference_id_idx',
        { table: 'oauthClient', unique: false, columns: ['referenceId'] }
      ],
      // A status's attachments load by statusId, in order.
      [
        'attachmentsIndex',
        {
          table: 'attachments',
          unique: false,
          columns: ['statusId', 'createdAt', 'updatedAt']
        }
      ],
      [
        'attachments_actorId_idx',
        { table: 'attachments', unique: false, columns: ['actorId'] }
      ],
      [
        'attachments_mediaId_idx',
        { table: 'attachments', unique: false, columns: ['mediaId'] }
      ],
      // One file per media and slot.
      [
        'media_edit_files_media_slot_unique',
        {
          table: 'media_edit_files',
          unique: true,
          columns: ['mediaId', 'slot']
        }
      ],
      // A status's or actor's search document is found by its entity.
      [
        'search_documents_entity_type_entity_id',
        {
          table: 'search_documents',
          unique: false,
          columns: ['entityType', 'entityId']
        }
      ],
      // Two refits racing for the next install sequence: exactly one wins.
      [
        'fitness_gear_component_periods_sequence_unique',
        {
          table: 'fitness_gear_component_periods',
          unique: true,
          columns: ['componentId', 'installSequence']
        }
      ],
      // One queued or running archive import per actor: the partial unique
      // index enforces it on both backends.
      [
        'account_imports_actor_active_idx',
        {
          table: 'account_imports',
          unique: true,
          columns: ['actorId']
        }
      ],
      [
        'account_imports_actor_created_idx',
        {
          table: 'account_imports',
          unique: false,
          columns: ['actorId', 'createdAt']
        }
      ],
      [
        'account_import_items_actor_source_unique',
        {
          table: 'account_import_items',
          unique: true,
          columns: ['actorId', 'kind', 'sourceId']
        }
      ],
      [
        'account_import_items_import_state_position_idx',
        {
          table: 'account_import_items',
          unique: false,
          columns: ['importId', 'state', 'position']
        }
      ]
    ])('keeps %s', async (name, expected) => {
      expect(await getIndex(name)).toEqual(expected)
    })

    // The gallery and the media reads join attachments to medias on
    // attachments.mediaId = medias.id. On SQLite that join only searches
    // attachments_mediaId_idx while mediaId is an integer column like
    // medias.id; against a varchar mediaId it scans attachments.
    it.runIf(testDb.backend === 'sqlite')(
      'joins medias to attachments through attachments_mediaId_idx on SQLite',
      async () => {
        const { rows: plan } = await sql<{ detail: string }>`
          explain query plan
          select attachments.id from medias
          join attachments on attachments.mediaId = medias.id
          where medias.actorId = ${'https://invariants.test/users/photographer'}
        `.execute(db)
        expect(plan.map(({ detail }) => detail).join('\n')).toContain(
          'USING INDEX attachments_mediaId_idx (mediaId=?)'
        )
      }
    )

    it('has no actorId-led announce index next to the originalStatusId-led one', async () => {
      expect(
        await getIndexDefinitionText('statuses_announce_actor_original_idx')
      ).toBeNull()
    })

    it('accepts actors whose usernames differ only by case', async () => {
      await db
        .insertInto('actors')
        .values(
          [
            { id: 'https://invariants.test/users/Alice', username: 'Alice' },
            { id: 'https://invariants.test/users/alice', username: 'alice' }
          ].map((actor) => ({ ...actor, domain: 'invariants.test' }))
        )
        .execute()

      const rows = await db
        .selectFrom('actors')
        .select('username')
        .where('domain', '=', 'invariants.test')
        .execute()
      // Sorted here: the database collation decides whether `Alice` or
      // `alice` comes first.
      expect(rows.map(({ username }) => username).sort()).toEqual([
        'Alice',
        'alice'
      ])
    })

    // The ledger's folded unique index: a case twin of a held handle is
    // refused, current or retired, so no actor can mint or rename onto a
    // handle another row holds.
    it('refuses a second actor_handles row whose username differs only by case', async () => {
      const now = new Date()
      await db
        .insertInto('actor_handles')
        .values({
          id: 'invariants-handle-1',
          actorId: 'https://invariants.test/users/Alice',
          username: 'Alice',
          domain: 'invariants.test',
          createdAt: now,
          replacedAt: null
        })
        .execute()
      await expect(
        db
          .insertInto('actor_handles')
          .values({
            id: 'invariants-handle-2',
            actorId: 'https://invariants.test/users/alice',
            username: 'alice',
            domain: 'invariants.test',
            createdAt: now,
            replacedAt: null
          })
          .execute()
      ).rejects.toThrow()
    })

    it('refuses a second period with the same install sequence for a component', async () => {
      const now = new Date()
      const actorId = 'https://invariants.test/users/rider'
      await db
        .insertInto('actors')
        .values({ id: actorId, username: 'rider', domain: 'invariants.test' })
        .execute()
      await db
        .insertInto('fitness_gears')
        .values({
          id: 'invariants-gear',
          actorId,
          kind: 'bike',
          name: 'Bike',
          createdAt: now,
          updatedAt: now
        })
        .execute()
      await db
        .insertInto('fitness_gear_components')
        .values({
          id: 'invariants-component',
          gearId: 'invariants-gear',
          componentType: 'Chain',
          createdAt: now,
          updatedAt: now
        })
        .execute()
      const period = (id: string) => ({
        id,
        componentId: 'invariants-component',
        installSequence: 1,
        addedAt: now,
        removedAt: null,
        createdAt: now,
        updatedAt: now
      })

      await db
        .insertInto('fitness_gear_component_periods')
        .values(period('invariants-period-1'))
        .execute()
      await expect(
        db
          .insertInto('fitness_gear_component_periods')
          .values(period('invariants-period-2'))
          .execute()
      ).rejects.toThrow()
    })
  })

  describe('foreign keys', () => {
    // An account delete must detach or remove what refers to it: better-auth's
    // passkeys, two-factor rows, account exports and archive imports go with
    // it, the others block it.
    it('keeps the nine foreign keys to accounts and their delete rules', async () => {
      expect(await getForeignKeysTo('accounts')).toEqual(
        [
          { table: 'account_archives', from: 'accountId', onDelete: 'CASCADE' },
          {
            table: 'account_imports',
            from: 'accountId',
            onDelete: 'CASCADE'
          },
          { table: 'actors', from: 'accountId', onDelete: 'NO ACTION' },
          { table: 'oauthAccessToken', from: 'userId', onDelete: 'NO ACTION' },
          { table: 'oauthClient', from: 'userId', onDelete: 'NO ACTION' },
          { table: 'oauthConsent', from: 'userId', onDelete: 'NO ACTION' },
          { table: 'oauthRefreshToken', from: 'userId', onDelete: 'NO ACTION' },
          { table: 'passkey', from: 'userId', onDelete: 'CASCADE' },
          { table: 'twoFactor', from: 'userId', onDelete: 'CASCADE' }
        ].map((foreignKey) => ({
          ...foreignKey,
          references: 'accounts',
          to: 'id'
        }))
      )
    })

    // These block a session delete while a token still points at the
    // session, which is why a session delete detaches the OAuth tokens first
    // (lib/database/domains/account/sessions.ts).
    it('keeps the OAuth token foreign keys to sessions', async () => {
      expect(await getForeignKeysTo('sessions')).toEqual(
        ['oauthAccessToken', 'oauthRefreshToken'].map((table) => ({
          table,
          from: 'sessionId',
          references: 'sessions',
          to: 'id',
          onDelete: 'NO ACTION'
        }))
      )
    })
  })

  describe('columns', () => {
    // An account is unverified until it is verified: no default fills
    // `verifiedAt` in.
    it('leaves accounts.verifiedAt null when an insert omits it', async () => {
      const verifiedAt = await getColumn('accounts', 'verifiedAt')
      expect(verifiedAt?.hasDefaultValue).toBeFalse()
      expect(verifiedAt?.isNullable).toBeTrue()

      await db
        .insertInto('accounts')
        .values({ id: 'invariants-account', email: 'invariants@test.local' })
        .execute()
      const row = await db
        .selectFrom('accounts')
        .select('verifiedAt')
        .where('id', '=', 'invariants-account')
        .executeTakeFirstOrThrow()
      expect(row.verifiedAt).toBeNull()
    })

    // A media row that was never edited is at edit version 0.
    it('defaults medias.editVersion to 0 when an insert omits it', async () => {
      const editVersion = await getColumn('medias', 'editVersion')
      expect(editVersion?.dataType.toLowerCase()).toBe(
        testDb.backend === 'pg' ? 'int4' : 'integer'
      )
      expect(editVersion?.isNullable).toBeFalse()
      expect(editVersion?.hasDefaultValue).toBeTrue()

      await db
        .insertInto('medias')
        .values({
          id: 990001,
          actorId: 'https://invariants.test/users/photographer',
          original: 'medias/invariants.jpg',
          originalBytes: 1000,
          originalMimeType: 'image/jpeg',
          originalMetaData: JSON.stringify({ width: 640, height: 480 })
        })
        .execute()
      const row = await db
        .selectFrom('medias')
        .select('editVersion')
        .where('id', '=', 990001)
        .executeTakeFirstOrThrow()
      expect(Number(row.editVersion)).toBe(0)
    })

    it('stores attachments.mediaId as a nullable integer', async () => {
      const mediaId = await getColumn('attachments', 'mediaId')
      expect(mediaId?.dataType.toLowerCase()).toBe(
        testDb.backend === 'pg' ? 'int4' : 'integer'
      )
      expect(mediaId?.isNullable).toBeTrue()
    })
  })

  describe('full-text search', () => {
    it.runIf(testDb.backend === 'pg')(
      'keeps the GIN index over the simple text search vector',
      async () => {
        const definition = await getIndexDefinitionText(
          'search_documents_document_text_fts'
        )
        expect(definition).toMatch(/ using gin /i)
        expect(await getIndex('search_documents_document_text_fts')).toEqual({
          table: 'search_documents',
          unique: false,
          columns: ["to_tsvector('simple', documentText)"]
        })
      }
    )

    it.runIf(testDb.backend === 'sqlite')(
      'keeps the FTS table in step with search_documents through its triggers',
      async () => {
        const { rows: triggers } = await sql<{ name: string }>`
          select name from sqlite_master
          where type = 'trigger' and tbl_name = 'search_documents'
          order by name
        `.execute(db)
        expect(triggers.map(({ name }) => name)).toEqual([
          'search_documents_ad',
          'search_documents_ai',
          'search_documents_au'
        ])

        const matches = async (term: string) => {
          const { rows } = await sql<{ id: string }>`
            select id from search_documents_fts
            where search_documents_fts match ${term}
          `.execute(db)
          return rows.map(({ id }) => id)
        }

        await db
          .insertInto('search_documents')
          .values({
            id: 'invariants-document',
            entityType: 'status',
            entityId: 'invariants-status',
            documentText: 'zebrafish'
          })
          .execute()
        expect(await matches('zebrafish')).toEqual(['invariants-document'])

        await db
          .updateTable('search_documents')
          .set({ documentText: 'axolotl' })
          .where('id', '=', 'invariants-document')
          .execute()
        expect(await matches('zebrafish')).toEqual([])
        expect(await matches('axolotl')).toEqual(['invariants-document'])

        await db
          .deleteFrom('search_documents')
          .where('id', '=', 'invariants-document')
          .execute()
        expect(await matches('axolotl')).toEqual([])
      }
    )
  })
})
