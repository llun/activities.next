import type { Db } from '@/lib/database/kysely'
import {
  databaseBeforeAll,
  getTestDatabaseTable,
  getTestDatabaseWithInstance
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'
import { EXTERNAL_ACTOR1, seedExternal1 } from '@/lib/stub/seed/external1'

// Each test gets its own database. On PostgreSQL it is this worker's
// `_isolated` database, emptied by `prepare` per test (tables truncated and
// used sequences restarted, schema kept), so the suite runs on both backends.
const getFreshDatabaseWithInstance = async () => {
  const { database, db, prepare } = getTestDatabaseWithInstance(true)
  await prepare()
  await database.migrate()
  return { database, db }
}

const withFreshDatabase = async (
  test: (database: Database) => Promise<void>
) => {
  const { database } = await getFreshDatabaseWithInstance()
  try {
    await test(database)
  } finally {
    await database.destroy()
  }
}

const seedLocalActor = async (
  database: Database,
  seed: typeof seedActor1
): Promise<{ actorId: string; accountId: string }> => {
  await database.createAccount(seed)
  const actor = await database.getActorFromEmail({ email: seed.email })
  if (!actor || !actor.account) throw new Error('failed to seed actor')
  return { actorId: actor.id, accountId: actor.account.id }
}

describe('ModerationDatabase', () => {
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  afterAll(async () => {
    await Promise.all(table.map(([, database]) => database.destroy()))
  })

  describe('getModerationStatesForActors', () => {
    it.each([
      {
        description: 'returns suspendedAt for suspended actors',
        flag: 'suspended'
      },
      {
        description: 'returns silencedAt for silenced actors',
        flag: 'silenced'
      },
      {
        description: 'returns sensitizedAt for sensitized actors',
        flag: 'sensitized'
      }
    ])('$description', async ({ flag }) => {
      await withFreshDatabase(async (database) => {
        const { actorId } = await seedLocalActor(database, seedActor1)
        // A second, untouched actor must yield no map entry.
        const { actorId: cleanActorId } = await seedLocalActor(
          database,
          seedActor2
        )

        if (flag === 'suspended') {
          await database.setActorSuspended({ actorId, suspended: true })
        } else if (flag === 'silenced') {
          await database.setActorSilenced({ actorId, silenced: true })
        } else {
          await database.setActorSensitized({ actorId, sensitized: true })
        }

        const states = await database.getModerationStatesForActors({
          actorIds: [actorId, cleanActorId]
        })
        const entry = states.get(actorId)
        expect(entry).toBeDefined()
        expect(entry?.[`${flag}At` as keyof typeof entry]).toBeTruthy()
        // The untouched actor has no moderation state at all.
        expect(states.get(cleanActorId)).toBeUndefined()
      })
    })

    it('returns no entry for actors that do not exist', async () => {
      await withFreshDatabase(async (database) => {
        const states = await database.getModerationStatesForActors({
          actorIds: ['https://remote.example/users/ghost']
        })
        expect(states.size).toBe(0)
      })
    })
  })

  describe('rejectPendingAccount', () => {
    it('returns false and keeps an already-approved account', async () => {
      await withFreshDatabase(async (database) => {
        const { accountId } = await seedLocalActor(database, seedActor1)

        const rejected = await database.rejectPendingAccount({ accountId })
        expect(rejected).toBe(false)
        expect(
          await database.getAccountFromId({ id: accountId })
        ).not.toBeNull()
      })
    })
  })

  describe('createModerationAction', () => {
    it('inserts an audit row carrying the moderator, action and report link', async () => {
      await withFreshDatabase(async (database) => {
        const { actorId, accountId } = await seedLocalActor(
          database,
          seedActor1
        )

        const action = await database.createModerationAction({
          targetActorId: actorId,
          moderatorAccountId: accountId,
          moderatorActorId: actorId,
          action: 'suspend',
          reportId: 'report-1',
          text: 'spam'
        })

        expect(action.id).toBeTruthy()
        expect(action.targetActorId).toBe(actorId)
        expect(action.moderatorAccountId).toBe(accountId)
        expect(action.action).toBe('suspend')
        expect(action.reportId).toBe('report-1')
        expect(action.text).toBe('spam')
        expect(action.createdAt).toBeGreaterThan(0)
      })
    })

    it('defaults text to empty and optional ids to null', async () => {
      await withFreshDatabase(async (database) => {
        const { actorId, accountId } = await seedLocalActor(
          database,
          seedActor1
        )

        const action = await database.createModerationAction({
          targetActorId: actorId,
          moderatorAccountId: accountId,
          action: 'none'
        })

        expect(action.text).toBe('')
        expect(action.moderatorActorId).toBeNull()
        expect(action.reportId).toBeNull()
      })
    })
  })

  describe('getAdminAccounts', () => {
    const seedFixture = async (database: Database) => {
      const { actorId: localActorId } = await seedLocalActor(
        database,
        seedActor1
      )
      const { actorId: suspendedActorId } = await seedLocalActor(
        database,
        seedActor2
      )
      await database.setActorSuspended({
        actorId: suspendedActorId,
        suspended: true
      })
      await database.createActor(seedExternal1)
      return { localActorId, suspendedActorId, remoteActorId: EXTERNAL_ACTOR1 }
    }

    it('lists local and remote actors but excludes the headless signer', async () => {
      await withFreshDatabase(async (database) => {
        const { localActorId, suspendedActorId, remoteActorId } =
          await seedFixture(database)
        // Materialize the headless federation signing actor (accountId null on
        // the configured host) — it must never appear in the admin listing.
        const signer = await database.getFederationSigningActor()
        if (!signer) throw new Error('Expected a federation signing actor')

        const records = await database.getAdminAccounts({ limit: 100 })
        const ids = records.map((record) => record.actor.id)

        expect(ids).toContain(localActorId)
        expect(ids).toContain(suspendedActorId)
        expect(ids).toContain(remoteActorId)
        expect(ids).not.toContain(signer.id)
      })
    })

    it.each([
      {
        description: 'local filter keeps only account-backed actors',
        filter: { local: true },
        present: 'local',
        absent: 'remote'
      },
      {
        description: 'remote filter keeps only foreign actors',
        filter: { remote: true },
        present: 'remote',
        absent: 'local'
      },
      {
        description: 'suspended filter keeps only suspended actors',
        filter: { suspended: true },
        present: 'suspended',
        absent: 'local'
      }
    ])('$description', async ({ filter, present, absent }) => {
      await withFreshDatabase(async (database) => {
        const ids = await seedFixture(database)
        const idFor = (key: string) =>
          key === 'local'
            ? ids.localActorId
            : key === 'suspended'
              ? ids.suspendedActorId
              : ids.remoteActorId

        const records = await database.getAdminAccounts({
          limit: 100,
          ...filter
        })
        const resultIds = records.map((record) => record.actor.id)

        expect(resultIds).toContain(idFor(present))
        expect(resultIds).not.toContain(idFor(absent))
      })
    })
  })

  describe('getAdminAccounts filters', () => {
    // A rich fixture: one local account per moderation state, a staff account,
    // and a remote actor — so every v1/v2 filter can be exercised.
    const seedRichFixture = async (database: Database, db: Db) => {
      const make = async (username: string) => {
        const accountId = await database.createAccount({
          email: `${username}@test.llun.dev`,
          username,
          passwordHash: 'hash',
          domain: 'test.llun.dev',
          privateKey: 'private',
          publicKey: 'public'
        })
        return {
          accountId,
          actorId: `https://test.llun.dev/users/${username}`
        }
      }
      const active = await make('activeuser')
      const suspended = await make('suspendeduser')
      const silenced = await make('silenceduser')
      const sensitized = await make('sensitizeduser')
      const disabled = await make('disableduser')
      const pending = await make('pendinguser')
      const staff = await make('staffuser')
      await database.setActorSuspended({
        actorId: suspended.actorId,
        suspended: true
      })
      await database.setActorSilenced({
        actorId: silenced.actorId,
        silenced: true
      })
      await database.setActorSensitized({
        actorId: sensitized.actorId,
        sensitized: true
      })
      await database.setAccountDisabled({
        accountId: disabled.accountId,
        disabled: true
      })
      await db
        .updateTable('accounts')
        .set({ approvedAt: null })
        .where('id', '=', pending.accountId)
        .execute()
      await db
        .updateTable('accounts')
        .set({ role: 'admin' })
        .where('id', '=', staff.accountId)
        .execute()
      await database.createActor(seedExternal1)
      return {
        active: active.actorId,
        suspended: suspended.actorId,
        silenced: silenced.actorId,
        sensitized: sensitized.actorId,
        disabled: disabled.actorId,
        pending: pending.actorId,
        staff: staff.actorId,
        remote: EXTERNAL_ACTOR1
      }
    }

    it.each([
      {
        description: 'active',
        filter: { active: true },
        present: 'active',
        absent: 'suspended'
      },
      {
        description: 'pending',
        filter: { pending: true },
        present: 'pending',
        absent: 'remote'
      },
      {
        description: 'disabled',
        filter: { disabled: true },
        present: 'disabled',
        absent: 'active'
      },
      {
        description: 'silenced',
        filter: { silenced: true },
        present: 'silenced',
        absent: 'active'
      },
      {
        description: 'sensitized',
        filter: { sensitized: true },
        present: 'sensitized',
        absent: 'active'
      },
      {
        description: 'suspended',
        filter: { suspended: true },
        present: 'suspended',
        absent: 'active'
      },
      {
        description: 'staff',
        filter: { staff: true },
        present: 'staff',
        absent: 'active'
      },
      {
        description: 'username substring',
        filter: { username: 'activeuser' },
        present: 'active',
        absent: 'suspended'
      },
      {
        description: 'by_domain',
        filter: { byDomain: 'llun.dev' },
        present: 'remote',
        absent: 'active'
      },
      {
        description: 'email substring',
        filter: { email: 'activeuser@' },
        present: 'active',
        absent: 'suspended'
      }
    ])('filters by $description', async ({ filter, present, absent }) => {
      const { database, db } = await getFreshDatabaseWithInstance()
      try {
        const ids = await seedRichFixture(database, db)
        const records = await database.getAdminAccounts({
          limit: 100,
          ...filter
        })
        const resultIds = records.map((record) => record.actor.id)
        expect(resultIds).toContain(ids[present as keyof typeof ids])
        expect(resultIds).not.toContain(ids[absent as keyof typeof ids])
      } finally {
        await database.destroy()
      }
    })

    it('returns an empty pending page today and never lists remote actors as pending', async () => {
      await withFreshDatabase(async (database) => {
        await seedLocalActor(database, seedActor1)
        await seedLocalActor(database, seedActor2)
        // A remote actor has no account row; it must NOT be treated as pending.
        await database.createActor(seedExternal1)
        const pending = await database.getAdminAccounts({
          limit: 100,
          pending: true
        })
        expect(pending).toEqual([])
      })
    })
  })

  describe('getAdminAccount', () => {
    it('returns a null account for a remote actor and null for an unknown id', async () => {
      await withFreshDatabase(async (database) => {
        await database.createActor(seedExternal1)
        const remote = await database.getAdminAccount({
          actorId: EXTERNAL_ACTOR1
        })
        expect(remote?.actor.id).toBe(EXTERNAL_ACTOR1)
        expect(remote?.account).toBeNull()

        expect(
          await database.getAdminAccount({
            actorId: 'https://nope.example/users/ghost'
          })
        ).toBeNull()
      })
    })
  })
})
