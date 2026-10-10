import {
  getInstanceActivity,
  incrementLocalStatusBucket,
  recordWeeklyLogin,
  recordWeeklyLoginSafely
} from '@/lib/database/domains/instanceActivity/queries'
import { kyselyFor } from '@/lib/database/kysely'
import { formatBucketHour } from '@/lib/database/sql/utils/counterBucket'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'

// The same queries as instanceActivity.test.ts, on the committed schema and on
// both backends (that suite builds a minimal SQLite schema by hand).
describe('instance activity on both backends', () => {
  const testDb = createTestDatabase()
  const { knex } = testDb
  const HOUR = 60 * 60 * 1000
  const WEEK = 7 * 24 * HOUR

  beforeAll(async () => {
    await testDb.prepare()
    await testDb.database.migrate()
  })

  beforeEach(async () => {
    await knex('actors').delete()
    await knex('accounts').delete()
    await knex('counters').delete()
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  const seedBucket = (
    type: string,
    hour: Date,
    value: number,
    bucketHour: Date | null = hour
  ) =>
    knex('counters').insert({
      id: `bucket:${type}:${formatBucketHour(hour)}`,
      value,
      bucketHour,
      createdAt: hour,
      updatedAt: hour
    })

  const bucketTotal = async (type: string) => {
    const rows = await knex('counters')
      .where('id', 'like', `bucket:${type}:%`)
      .select('value')
    return rows.reduce((total, row) => total + Number(row.value), 0)
  }

  const marker = async (accountId: string) => {
    const row = await knex('counters')
      .where('id', `unique-login:${accountId}`)
      .first('value')
    return row && Number(row.value)
  }

  describe('getInstanceActivity', () => {
    it('sums the three bucket types per week and skips rows outside the window', async () => {
      const now = new Date('2031-05-28T12:00:00.000Z')
      const newest = Date.UTC(2031, 4, 26)
      const oldest = newest - 11 * WEEK
      const newestEnd = newest + WEEK
      await seedBucket('local-statuses', new Date(newest + HOUR), 3)
      await seedBucket('accounts', new Date(newest - WEEK + 8 * HOUR), 2)
      await seedBucket('logins', new Date(newest - 2 * WEEK + 12 * HOUR), 4)
      await seedBucket('logins', new Date(newest - 2 * WEEK + 13 * HOUR), 5)
      // The first hour of the oldest week still counts.
      await seedBucket('accounts', new Date(oldest), 7)
      // Neighbours that must not count: another counter type, a bucket without
      // bucketHour, a bucketHour outside the window, and ids just before the
      // first and at the end of the id range whose bucketHour is inside it.
      await seedBucket('statuses', new Date(newest + 2 * HOUR), 999)
      await seedBucket('logins', new Date(newest + 3 * HOUR), 100, null)
      await seedBucket(
        'logins',
        new Date(newest + 4 * HOUR),
        100,
        new Date(newestEnd + HOUR)
      )
      await knex('counters').insert([
        {
          id: `bucket:logins:${formatBucketHour(new Date(oldest - HOUR))}`,
          value: 100,
          bucketHour: new Date(newest + HOUR),
          createdAt: new Date(oldest),
          updatedAt: new Date(oldest)
        },
        {
          id: `bucket:logins:${formatBucketHour(new Date(newestEnd))}`,
          value: 100,
          bucketHour: new Date(newest + HOUR),
          createdAt: new Date(oldest),
          updatedAt: new Date(oldest)
        }
      ])

      const weeks = await getInstanceActivity(testDb.db, { now })

      const weekKey = (start: number) => String(start / 1000)
      expect(weeks).toHaveLength(12)
      expect(weeks[0]).toEqual({
        week: weekKey(newest),
        statuses: '3',
        logins: '0',
        registrations: '0'
      })
      expect(weeks[1]).toEqual({
        week: weekKey(newest - WEEK),
        statuses: '0',
        logins: '0',
        registrations: '2'
      })
      expect(weeks[2]).toEqual({
        week: weekKey(newest - 2 * WEEK),
        statuses: '0',
        logins: '9',
        registrations: '0'
      })
      expect(weeks[11]).toEqual({
        week: weekKey(oldest),
        statuses: '0',
        logins: '0',
        registrations: '7'
      })
    })
  })

  describe('recordWeeklyLogin', () => {
    const week1 = Date.UTC(2032, 2, 1)
    const week2 = week1 + WEEK

    it('counts the first login of each week once per account', async () => {
      const db = testDb.db
      await recordWeeklyLogin(db, 'login-a', new Date(week1 + 10 * HOUR))
      await recordWeeklyLogin(db, 'login-a', new Date(week1 + 30 * HOUR))
      // Another account keeps its own marker.
      await recordWeeklyLogin(db, 'login-b', new Date(week1 + 11 * HOUR))
      expect(await bucketTotal('logins')).toBe(2)

      await recordWeeklyLogin(db, 'login-a', new Date(week2 + HOUR))
      expect(await bucketTotal('logins')).toBe(3)
      // A login stamped in an earlier week than the marker does not count.
      await recordWeeklyLogin(db, 'login-a', new Date(week1 + 40 * HOUR))
      expect(await bucketTotal('logins')).toBe(3)

      expect(await marker('login-a')).toBe(week2 / 1000)
      expect(await marker('login-b')).toBe(week1 / 1000)
    })

    it('counts a login once when the same account logs in concurrently', async () => {
      await Promise.all(
        Array.from({ length: 5 }, () =>
          recordWeeklyLogin(testDb.db, 'login-race', new Date(week1 + HOUR))
        )
      )

      expect(await bucketTotal('logins')).toBe(1)
    })

    it('does nothing without an account id', async () => {
      await recordWeeklyLogin(testDb.db, null, new Date(week1))
      await recordWeeklyLogin(testDb.db, undefined, new Date(week1))
      await recordWeeklyLogin(testDb.db, '', new Date(week1))

      const [{ total }] = await knex('counters').count({ total: '*' })
      expect(Number(total)).toBe(0)
    })

    it('joins the Knex transaction it is called from', async () => {
      await knex.transaction(async (trx) => {
        await recordWeeklyLoginSafely(
          kyselyFor(trx),
          'login-trx',
          new Date(week1 + HOUR)
        )
      })
      expect(await marker('login-trx')).toBe(week1 / 1000)

      const rolledBack = await knex.transaction()
      await recordWeeklyLoginSafely(
        kyselyFor(rolledBack),
        'login-rollback',
        new Date(week1 + HOUR)
      )
      await rolledBack.rollback()
      expect(await marker('login-rollback')).toBeUndefined()
    })

    it('keeps the marker retryable when the bucket write fails', async () => {
      // The hour's first login inserts its bucket row (one upsert), so the
      // failure is raised on that insert.
      const pg = testDb.backend === 'pg'
      if (pg) {
        await knex.raw(`
          CREATE FUNCTION fail_login_bucket() RETURNS trigger AS $$
          BEGIN RAISE EXCEPTION 'bucket failure'; END $$ LANGUAGE plpgsql
        `)
        await knex.raw(`
          CREATE TRIGGER fail_login_bucket BEFORE INSERT ON counters
          FOR EACH ROW WHEN (NEW.id LIKE 'bucket:logins:%')
          EXECUTE FUNCTION fail_login_bucket()
        `)
      } else {
        await knex.raw(`
          CREATE TRIGGER fail_login_bucket BEFORE INSERT ON counters
          WHEN NEW.id LIKE 'bucket:logins:%'
          BEGIN SELECT RAISE(ABORT, 'bucket failure'); END
        `)
      }
      try {
        await expect(
          recordWeeklyLogin(testDb.db, 'login-retry', new Date(week1 + HOUR))
        ).rejects.toThrow('bucket failure')
      } finally {
        await knex.raw(
          pg
            ? 'DROP TRIGGER fail_login_bucket ON counters; DROP FUNCTION fail_login_bucket()'
            : 'DROP TRIGGER fail_login_bucket'
        )
      }
      expect(await marker('login-retry')).toBeUndefined()

      await recordWeeklyLogin(testDb.db, 'login-retry', new Date(week1 + HOUR))
      expect(await marker('login-retry')).toBe(week1 / 1000)
      expect(await bucketTotal('logins')).toBe(1)
    })
  })

  describe('incrementLocalStatusBucket', () => {
    it('adds to the local-statuses bucket of the hour only', async () => {
      const at = new Date('2032-03-01T10:20:00.000Z')
      await incrementLocalStatusBucket(testDb.db, at)
      await incrementLocalStatusBucket(testDb.db, at)
      await seedBucket('statuses', new Date('2032-03-01T10:00:00.000Z'), 50)

      expect(await bucketTotal('local-statuses')).toBe(2)
      expect(await bucketTotal('statuses')).toBe(50)
      const row = await knex('counters')
        .where('id', 'bucket:local-statuses:2032030110')
        .first('bucketHour')
      expect(row?.bucketHour).not.toBeNull()
    })
  })

  describe('getInstancePeers', () => {
    const insertActors = (domains: (string | null)[]) =>
      knex('actors').insert(
        domains.map((domain, index) => ({
          id: `https://peer.test/users/${index}`,
          username: `peer${index}`,
          domain,
          createdAt: new Date(index)
        }))
      )

    it('lists each remote domain once, sorted, without the local one', async () => {
      await insertActors([
        'zeta.test',
        'alpha.test',
        'alpha.test',
        'llun.test',
        'llun.test.evil',
        '',
        null
      ])
      const peers = (localDomain: string) =>
        testDb.database.getInstancePeers({ localDomain })

      expect(await peers('llun.test')).toEqual([
        'alpha.test',
        'llun.test.evil',
        'zeta.test'
      ])
      // A configured host may carry a scheme and a port.
      expect(await peers('https://llun.test')).toEqual(await peers('llun.test'))
      expect(await testDb.database.getInstancePeers()).toEqual([
        'alpha.test',
        'llun.test',
        'llun.test.evil',
        'zeta.test'
      ])
    })
  })

  describe('getInstanceAdminActorId', () => {
    it('is null without an admin account', async () => {
      await knex('accounts').insert({ id: 'acct-user', email: 'u@x.test' })
      await knex('actors').insert({
        id: 'https://llun.test/users/user',
        accountId: 'acct-user',
        createdAt: new Date(1)
      })

      expect(await testDb.database.getInstanceAdminActorId()).toBeNull()
    })

    it('picks the earliest live local actor of an admin account', async () => {
      await knex('accounts').insert([
        { id: 'acct-user', email: 'u@x.test', role: null },
        { id: 'acct-mod', email: 'm@x.test', role: 'moderator' },
        { id: 'acct-admin', email: 'a@x.test', role: 'admin' }
      ])
      await knex('actors').insert([
        {
          id: 'https://llun.test/users/user',
          accountId: 'acct-user',
          createdAt: new Date(1)
        },
        {
          id: 'https://llun.test/users/mod',
          accountId: 'acct-mod',
          createdAt: new Date(2)
        },
        {
          id: 'https://remote.test/users/remote',
          accountId: null,
          createdAt: new Date(3)
        },
        {
          id: 'https://llun.test/users/admin-deleted',
          accountId: 'acct-admin',
          deletionStatus: 'scheduled',
          createdAt: new Date(4)
        },
        {
          id: 'https://llun.test/users/admin-late',
          accountId: 'acct-admin',
          createdAt: new Date(6)
        },
        {
          id: 'https://llun.test/users/admin',
          accountId: 'acct-admin',
          createdAt: new Date(5)
        }
      ])

      expect(await testDb.database.getInstanceAdminActorId()).toBe(
        'https://llun.test/users/admin'
      )
    })
  })
})
