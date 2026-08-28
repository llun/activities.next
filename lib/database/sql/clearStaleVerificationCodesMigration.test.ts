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

// `20260320072514_better_auth_columns`' own timestamp: rows older than this
// predate the backfill that wrongly marked them verified.
const BEFORE_BACKFILL = new Date('2026-01-01T00:00:00Z')
const AFTER_BACKFILL = new Date('2026-08-01T00:00:00Z')

describe('clear stale verification codes migration', () => {
  let database: knex.Knex

  beforeEach(async () => {
    database = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })
    await createAccountsTable(database)
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
      createdAt: values.createdAt ?? BEFORE_BACKFILL
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

  it('leaves a pending registration newer than the backfill alone', async () => {
    // The case `emailVerified = false` cannot catch. knex applies pending
    // migrations in timestamp order in ONE `yarn migrate`, so on a database
    // that predates `20260320072514` — a restore from a pre-March dump, a
    // staging copy, an operator catching up — that backfill runs moments
    // before this migration and marks a registration made minutes earlier as
    // verified. Without the `createdAt` bound this would then destroy a code
    // that is genuinely live: the account is silently confirmed without anyone
    // proving the address, and the link already sitting in the user's inbox is
    // dead forever.
    await insertAccount('caught-up-instance', {
      verificationCode: 'live-code',
      emailVerified: true,
      createdAt: AFTER_BACKFILL
    })

    await migration.up(database)

    expect(await readCode('caught-up-instance')).toBe('live-code')
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
