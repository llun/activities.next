import knex from 'knex'

import * as migration from '@/migrations/20260828140000_clear_stale_verification_codes'

// Only the columns the migration reads and writes, matching the other
// `accounts` migration tests. `verifiedAt` carries the same
// DEFAULT CURRENT_TIMESTAMP the real schema does, because that default is the
// whole reason this migration exists: it is what made
// `20260320072514_better_auth_columns`' `whereNotNull('verifiedAt')` backfill
// match every row rather than only the confirmed ones.
const createAccountsTable = async (database: knex.Knex) => {
  await database.schema.createTable('accounts', (table) => {
    table.string('id').primary()
    table.string('email')
    table.string('verificationCode')
    table.timestamp('verifiedAt').defaultTo(database.fn.now())
    table.boolean('emailVerified').defaultTo(false)
    table.timestamp('createdAt')
  })
}

const BACKFILL = '20260320072514_better_auth_columns.js'

// The migration reads the real knex ledger to learn when the backfill ran, so
// the fixture builds one. `batch` is the whole signal: a backfill sharing the
// pass in flight means it ran moments ago and its `emailVerified` cannot be
// trusted to mean anyone has been signing in.
const createMigrationLedger = async (
  database: knex.Knex,
  { backfillBatch, latestBatch }: { backfillBatch: number; latestBatch: number }
) => {
  await database.schema.createTable('knex_migrations', (table) => {
    table.increments('id')
    table.string('name')
    table.integer('batch')
    table.timestamp('migration_time')
  })
  await database('knex_migrations').insert([
    { name: BACKFILL, batch: backfillBatch, migration_time: new Date() },
    {
      name: 'later_migration.js',
      batch: latestBatch,
      migration_time: new Date()
    }
  ])
}

describe('clear stale verification codes migration', () => {
  let database: knex.Knex

  beforeEach(async () => {
    database = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })
    await createAccountsTable(database)
    await createMigrationLedger(database, { backfillBatch: 1, latestBatch: 2 })
  })

  afterEach(async () => {
    await database.destroy()
  })

  const insertAccount = async (
    id: string,
    values: {
      verificationCode: string | null
      emailVerified: boolean
      createdAt?: Date
    }
  ) => {
    await database('accounts').insert({
      id,
      email: `${id}@llun.test`,
      verificationCode: values.verificationCode,
      emailVerified: values.emailVerified,
      createdAt: values.createdAt ?? new Date('2026-01-01T00:00:00Z')
    })
  }

  const readCode = async (id: string) => {
    const row = await database('accounts').where('id', id).first()
    return row?.verificationCode
  }

  it('clears a stale code on an account the 2026-03-20 backfill already marked verified', async () => {
    // The cohort this exists for: registered before 2026-03-20, never clicked
    // the link, but `emailVerified` was set true anyway because the backfill
    // keyed on a column the schema default made non-null. better-auth has been
    // letting them sign in ever since; the confirmation guard would refuse them
    // on the leftover code with no way back.
    await insertAccount('legacy-pending', {
      verificationCode: 'stale-code-from-2025',
      emailVerified: true
    })

    await migration.up(database)

    expect(await readCode('legacy-pending')).toBe('')
  })

  it('clears a code for an account created inside the deploy gap', async () => {
    // The cohort an earlier revision lost. It bounded on `createdAt` against
    // this migration's SIBLING FILENAME timestamp — the instant `migrate:make`
    // ran on the author's machine, which no deployment coincides with; that
    // migration was merged eleven hours later. Every account registered between
    // the two was skipped and, since #1613, locked out with no way back. What
    // matters is when the backfill RAN here, which is what the ledger says.
    await insertAccount('registered-during-deploy-gap', {
      verificationCode: 'stale-code',
      emailVerified: true,
      createdAt: new Date('2026-03-20T12:00:00Z')
    })

    await migration.up(database)

    expect(await readCode('registered-during-deploy-gap')).toBe('')
  })

  it('does nothing when the backfill ran in the same pass', async () => {
    // knex applies pending migrations in timestamp order in ONE `yarn migrate`,
    // so on a database that predates `20260320072514` — a restore from a
    // pre-March dump, a staging copy, an operator catching up — that backfill
    // runs moments before this migration and marks a registration made minutes
    // earlier as verified. Clearing then would destroy a code that is genuinely
    // live: the account silently confirmed with nobody proving the address, and
    // the link already in the user's inbox dead forever. Nothing is lost by
    // skipping, because `emailVerified` was only just populated there, so
    // nobody has been relying on it to sign in.
    await database('knex_migrations')
      .where('name', BACKFILL)
      .update({ batch: 2 })
    await insertAccount('caught-up-instance', {
      verificationCode: 'live-code',
      emailVerified: true
    })

    await migration.up(database)

    expect(await readCode('caught-up-instance')).toBe('live-code')
  })

  it('does nothing when the backfill never ran here', async () => {
    await database('knex_migrations').where('name', BACKFILL).delete()
    await insertAccount('no-backfill', {
      verificationCode: 'live-code',
      emailVerified: true
    })

    await migration.up(database)

    expect(await readCode('no-backfill')).toBe('live-code')
  })

  it('does nothing on a database with no migration ledger', async () => {
    // A database built straight from the schema dump: nothing to infer, and no
    // accounts to repair.
    await database.schema.dropTable('knex_migrations')
    await insertAccount('dump-built', {
      verificationCode: 'live-code',
      emailVerified: true
    })

    await migration.up(database)

    expect(await readCode('dump-built')).toBe('live-code')
  })

  it('leaves a genuinely pending registration gated', async () => {
    // `emailVerified` false is what separates a real pending registration from
    // the backfilled cohort. Clearing this one would confirm an address nobody
    // has proven they control — the exact thing the guard exists to refuse.
    await insertAccount('really-pending', {
      verificationCode: 'live-code',
      emailVerified: false
    })

    await migration.up(database)

    expect(await readCode('really-pending')).toBe('live-code')
  })

  it.each([
    {
      description: 'an already-confirmed account whose code is an empty string',
      id: 'confirmed',
      verificationCode: '',
      emailVerified: true,
      expected: ''
    },
    {
      description: 'an instance with no e-mail configured, which sets no code',
      id: 'no-email-configured',
      verificationCode: null,
      emailVerified: true,
      expected: null
    }
  ])('leaves $description untouched', async ({ id, expected, ...values }) => {
    await insertAccount(id, values)

    await migration.up(database)

    expect(await readCode(id)).toBe(expected)
  })

  it('is a no-op on the way down rather than reissuing codes', async () => {
    await insertAccount('legacy-pending', {
      verificationCode: 'stale-code',
      emailVerified: true
    })
    await migration.up(database)

    await migration.down()

    expect(await readCode('legacy-pending')).toBe('')
  })
})
