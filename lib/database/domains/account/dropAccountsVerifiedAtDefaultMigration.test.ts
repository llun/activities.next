import knex from 'knex'

import * as migration from '@/migrations/20260828200538_drop_accounts_verifiedat_default'

type SqliteMasterRow = { sql: string | null }
type PragmaForeignKeyRow = {
  table: string
  from: string
  to: string
  on_delete: string
}

describe('drop accounts.verifiedAt default migration', () => {
  let database: knex.Knex

  const createSchema = async (db: knex.Knex) => {
    // accounts table with original DEFAULT CURRENT_TIMESTAMP
    await db.schema.createTable('accounts', (table) => {
      table.string('id').primary()
      table.string('email').unique()
      table.timestamp('createdAt').defaultTo(db.fn.now())
      table.timestamp('updatedAt').defaultTo(db.fn.now())
      table.string('passwordHash')
      table.string('verificationCode')
      table.timestamp('verifiedAt', { useTz: true }).defaultTo(db.fn.now())
      table.string('defaultActorId')
      table.string('emailChangePending')
      table.string('emailChangeCode')
      table.timestamp('emailChangeCodeExpiresAt')
      table.timestamp('emailVerifiedAt')
      table.string('passwordResetCode')
      table.timestamp('passwordResetCodeExpiresAt')
      table.string('name')
      table.text('image')
      table.boolean('emailVerified').defaultTo(false)
      table.string('iconUrl')
      table.text('role')
      table.boolean('twoFactorEnabled').notNullable().defaultTo(false)
      table.timestamp('disabledAt')
      table.timestamp('approvedAt')

      table.index(['email', 'createdAt', 'updatedAt'], 'accountsIndex')
      table.index('verificationCode', 'verificationCodeIndex')
      table.index('passwordResetCode', 'passwordResetCodeIndex')
    })

    // 1. actors
    await db.schema.createTable('actors', (table) => {
      table.string('id').primary()
      table.string('username')
      table.string('accountId').references('id').inTable('accounts')
    })

    // 2. oauthClient
    await db.schema.createTable('oauthClient', (table) => {
      table.string('id').primary()
      table.string('clientId').notNullable()
      table.string('userId').references('id').inTable('accounts')
    })

    // 3. oauthRefreshToken
    await db.schema.createTable('oauthRefreshToken', (table) => {
      table.string('id').primary()
      table.text('token').notNullable()
      table.string('clientId').notNullable()
      table.string('userId').notNullable().references('id').inTable('accounts')
    })

    // 4. oauthAccessToken
    await db.schema.createTable('oauthAccessToken', (table) => {
      table.string('id').primary()
      table.text('token').notNullable()
      table.string('clientId').notNullable()
      table.string('userId').references('id').inTable('accounts')
    })

    // 5. oauthConsent
    await db.schema.createTable('oauthConsent', (table) => {
      table.string('id').primary()
      table.string('clientId').notNullable()
      table.string('userId').references('id').inTable('accounts')
    })

    // 6. passkey (on delete CASCADE)
    await db.schema.createTable('passkey', (table) => {
      table.string('id').primary()
      table
        .string('userId')
        .notNullable()
        .references('id')
        .inTable('accounts')
        .onDelete('CASCADE')
    })

    // 7. twoFactor (on delete CASCADE)
    await db.schema.createTable('twoFactor', (table) => {
      table.string('id').primary()
      table
        .string('userId')
        .notNullable()
        .references('id')
        .inTable('accounts')
        .onDelete('CASCADE')
    })
  }

  const getAccountsTableSql = async (): Promise<string> => {
    const rows: SqliteMasterRow[] = await database.raw(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'accounts'"
    )
    return rows[0]?.sql ?? ''
  }

  beforeEach(async () => {
    database = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })
    await createSchema(database)
  })

  afterEach(async () => {
    await database.destroy()
  })

  it('drops DEFAULT CURRENT_TIMESTAMP from accounts.verifiedAt on up', async () => {
    const beforeSql = await getAccountsTableSql()
    expect(beforeSql).toMatch(/verifiedAt.*DEFAULT/i)

    await migration.up(database)

    const afterSql = await getAccountsTableSql()
    // verifiedAt should no longer have a DEFAULT clause
    expect(afterSql).toMatch(/[`"]verifiedAt[`"]\s+datetime(?!\s+DEFAULT)/i)
  })

  it('inserts null verifiedAt when the column is omitted on insert after migration', async () => {
    await migration.up(database)

    await database('accounts').insert({
      id: 'acc-unverified',
      email: 'unverified@test.local'
    })

    const row = await database('accounts').where('id', 'acc-unverified').first()
    expect(row?.verifiedAt).toBeNull()
  })

  it('preserves all accounts indexes across the SQLite table rebuild', async () => {
    await migration.up(database)

    const indexes: { name: string }[] = await database.raw(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'accounts'"
    )
    const indexNames = indexes.map((i) => i.name)

    expect(indexNames).toContain('accounts_email_unique')
    expect(indexNames).toContain('accountsIndex')
    expect(indexNames).toContain('verificationCodeIndex')
    expect(indexNames).toContain('passwordResetCodeIndex')
  })

  it('preserves foreign keys across all 7 referencing tables with correct cascade rules', async () => {
    await migration.up(database)

    const fkTables = [
      { name: 'actors', from: 'accountId', onDelete: 'NO ACTION' },
      { name: 'oauthClient', from: 'userId', onDelete: 'NO ACTION' },
      { name: 'oauthRefreshToken', from: 'userId', onDelete: 'NO ACTION' },
      { name: 'oauthAccessToken', from: 'userId', onDelete: 'NO ACTION' },
      { name: 'oauthConsent', from: 'userId', onDelete: 'NO ACTION' },
      { name: 'passkey', from: 'userId', onDelete: 'CASCADE' },
      { name: 'twoFactor', from: 'userId', onDelete: 'CASCADE' }
    ]

    for (const { name, from, onDelete } of fkTables) {
      const fks: PragmaForeignKeyRow[] = await database.raw(
        `PRAGMA foreign_key_list(${name})`
      )
      const matchingFk = fks.find(
        (fk) => fk.table === 'accounts' && fk.from === from
      )
      expect(matchingFk).toBeDefined()
      expect(matchingFk?.to).toBe('id')
      expect(matchingFk?.on_delete).toBe(onDelete)
    }

    const fkErrors = await database.raw('PRAGMA foreign_key_check')
    expect(fkErrors).toEqual([])
  })

  it('restores DEFAULT CURRENT_TIMESTAMP on rollback (down)', async () => {
    await migration.up(database)
    await migration.down(database)

    const rollbackSql = await getAccountsTableSql()
    expect(rollbackSql).toMatch(/verifiedAt.*DEFAULT/i)

    await database('accounts').insert({
      id: 'acc-rollback',
      email: 'rollback@test.local'
    })

    const row = await database('accounts').where('id', 'acc-rollback').first()
    expect(row?.verifiedAt).not.toBeNull()
  })
})
