import {
  databaseBeforeAll,
  getTestDatabaseTable,
  getTestSQLDatabase,
  getTestSQLDatabaseWithInstance
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'
import { EXTERNAL_ACTOR1, seedExternal1 } from '@/lib/stub/seed/external1'

const withFreshDatabase = async (
  test: (database: Database) => Promise<void>
) => {
  const database = getTestSQLDatabase()
  await database.migrate()
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

  describe('setActorSuspended', () => {
    it('stamps suspendedAt when suspending and clears it when unsuspending', async () => {
      await withFreshDatabase(async (database) => {
        const { actorId } = await seedLocalActor(database, seedActor1)

        await database.setActorSuspended({ actorId, suspended: true })
        expect(
          (await database.getActorFromId({ id: actorId }))?.suspendedAt
        ).toBeTruthy()

        await database.setActorSuspended({ actorId, suspended: false })
        expect(
          (await database.getActorFromId({ id: actorId }))?.suspendedAt
        ).toBeNull()
      })
    })
  })

  describe('setActorSilenced', () => {
    it('stamps silencedAt when silencing and clears it when unsilencing', async () => {
      await withFreshDatabase(async (database) => {
        const { actorId } = await seedLocalActor(database, seedActor1)

        await database.setActorSilenced({ actorId, silenced: true })
        expect(
          (await database.getActorFromId({ id: actorId }))?.silencedAt
        ).toBeTruthy()

        await database.setActorSilenced({ actorId, silenced: false })
        expect(
          (await database.getActorFromId({ id: actorId }))?.silencedAt
        ).toBeNull()
      })
    })
  })

  describe('setActorSensitized', () => {
    it('stamps sensitizedAt when sensitizing and clears it when unsensitizing', async () => {
      await withFreshDatabase(async (database) => {
        const { actorId } = await seedLocalActor(database, seedActor1)

        await database.setActorSensitized({ actorId, sensitized: true })
        expect(
          (await database.getActorFromId({ id: actorId }))?.sensitizedAt
        ).toBeTruthy()

        await database.setActorSensitized({ actorId, sensitized: false })
        expect(
          (await database.getActorFromId({ id: actorId }))?.sensitizedAt
        ).toBeNull()
      })
    })
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

  describe('setAccountDisabled', () => {
    it('stamps disabledAt when disabling and clears it when enabling', async () => {
      await withFreshDatabase(async (database) => {
        const { accountId } = await seedLocalActor(database, seedActor1)

        await database.setAccountDisabled({ accountId, disabled: true })
        expect(
          (await database.getAccountFromId({ id: accountId }))?.disabledAt
        ).toBeTruthy()

        await database.setAccountDisabled({ accountId, disabled: false })
        expect(
          (await database.getAccountFromId({ id: accountId }))?.disabledAt
        ).toBeNull()
      })
    })
  })

  describe('approveAccount', () => {
    it('sets approvedAt when null and is idempotent', async () => {
      const { database, instance } = getTestSQLDatabaseWithInstance()
      await database.migrate()
      try {
        const { accountId } = await seedLocalActor(database, seedActor1)
        // createAccount approves on insert; make it pending for this test.
        await instance('accounts')
          .update({ approvedAt: null })
          .where('id', accountId)

        await database.approveAccount({ accountId })
        const approved = (await database.getAccountFromId({ id: accountId }))
          ?.approvedAt
        expect(approved).toBeTruthy()

        // Idempotent: approving again keeps the original timestamp.
        await database.approveAccount({ accountId })
        expect(
          (await database.getAccountFromId({ id: accountId }))?.approvedAt
        ).toBe(approved)
      } finally {
        await database.destroy()
      }
    })
  })

  describe('rejectPendingAccount', () => {
    it('deletes a pending account and its actors and returns true', async () => {
      const { database, instance } = getTestSQLDatabaseWithInstance()
      await database.migrate()
      try {
        const { accountId, actorId } = await seedLocalActor(
          database,
          seedActor1
        )
        await instance('accounts')
          .update({ approvedAt: null })
          .where('id', accountId)

        const rejected = await database.rejectPendingAccount({ accountId })
        expect(rejected).toBe(true)
        expect(await database.getAccountFromId({ id: accountId })).toBeNull()
        expect(await database.getActorFromId({ id: actorId })).toBeNull()
        // The credential provider row created alongside the account is gone too,
        // so nothing dangles referencing the deleted account.
        expect(
          await instance('account_providers')
            .where('accountId', accountId)
            .first()
        ).toBeUndefined()
        expect(
          await instance('sessions').where('accountId', accountId).first()
        ).toBeUndefined()
      } finally {
        await database.destroy()
      }
    })

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

    it('returns false for an account that does not exist', async () => {
      await withFreshDatabase(async (database) => {
        const rejected = await database.rejectPendingAccount({
          accountId: 'does-not-exist'
        })
        expect(rejected).toBe(false)
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

  describe('deleteAllAccountSessions', () => {
    it('removes every session for the account', async () => {
      await withFreshDatabase(async (database) => {
        const { accountId, actorId } = await seedLocalActor(
          database,
          seedActor1
        )
        await database.createAccountSession({
          accountId,
          actorId,
          token: 'token-1',
          expireAt: Date.now() + 60_000
        })
        await database.createAccountSession({
          accountId,
          actorId,
          token: 'token-2',
          expireAt: Date.now() + 60_000
        })
        expect(
          (await database.getAccountAllSessions({ accountId })).length
        ).toBe(2)

        await database.deleteAllAccountSessions({ accountId })
        expect(
          (await database.getAccountAllSessions({ accountId })).length
        ).toBe(0)
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

    it.each([
      {
        description: 'max_id excludes the cursor and returns older records',
        cursor: 'max_id'
      },
      {
        description: 'min_id excludes the cursor and returns newer records',
        cursor: 'min_id'
      },
      {
        description: 'since_id excludes the cursor and returns newer records',
        cursor: 'since_id'
      }
    ])('$description', async ({ cursor }) => {
      await withFreshDatabase(async (database) => {
        await seedFixture(database)
        // Full listing, newest-first by (createdAt desc, id).
        const all = await database.getAdminAccounts({ limit: 100 })
        expect(all.length).toBe(3)
        const ids = all.map((record) => record.actor.id)

        if (cursor === 'max_id') {
          // Page after the newest (first) record — the two older ones.
          const page = await database.getAdminAccounts({
            limit: 100,
            maxId: ids[0]
          })
          const pageIds = page.map((record) => record.actor.id)
          expect(pageIds).not.toContain(ids[0])
          expect(pageIds).toContain(ids[1])
          expect(pageIds).toContain(ids[2])
        } else {
          // min_id/since_id page above the oldest (last) record.
          const page = await database.getAdminAccounts({
            limit: 100,
            [cursor === 'min_id' ? 'minId' : 'sinceId']: ids[2]
          })
          const pageIds = page.map((record) => record.actor.id)
          expect(pageIds).not.toContain(ids[2])
          expect(pageIds).toContain(ids[0])
          expect(pageIds).toContain(ids[1])
        }
      })
    })
  })

  describe('getAdminAccounts filters', () => {
    // A rich fixture: one local account per moderation state, a staff account,
    // and a remote actor — so every v1/v2 filter can be exercised.
    const seedRichFixture = async (
      database: Database,
      instance: ReturnType<typeof getTestSQLDatabaseWithInstance>['instance']
    ) => {
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
      await instance('accounts')
        .where('id', pending.accountId)
        .update({ approvedAt: null })
      await instance('accounts')
        .where('id', staff.accountId)
        .update({ role: 'admin' })
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
      const { database, instance } = getTestSQLDatabaseWithInstance()
      await database.migrate()
      try {
        const ids = await seedRichFixture(database, instance)
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
    it('returns the record with its account for a local actor', async () => {
      await withFreshDatabase(async (database) => {
        const { actorId, accountId } = await seedLocalActor(
          database,
          seedActor1
        )
        const record = await database.getAdminAccount({ actorId })
        expect(record?.actor.id).toBe(actorId)
        expect(record?.account?.id).toBe(accountId)
      })
    })

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

  describe('getSessionIpsForAccounts', () => {
    it('returns latest-first distinct ips per account', async () => {
      const { database, instance } = getTestSQLDatabaseWithInstance()
      await database.migrate()
      try {
        const { accountId, actorId } = await seedLocalActor(
          database,
          seedActor1
        )
        await database.createAccountSession({
          accountId,
          actorId,
          token: 'session-a',
          expireAt: Date.now() + 60_000
        })
        // Backfill the IP columns (createAccountSession does not set them).
        await instance('sessions')
          .where('token', 'session-a')
          .update({ ipAddress: '203.0.113.9' })

        const map = await database.getSessionIpsForAccounts({
          accountIds: [accountId]
        })
        expect(map.get(accountId)?.[0]?.ip).toBe('203.0.113.9')
      } finally {
        await database.destroy()
      }
    })
  })

  describe('setReportResolution', () => {
    it('stamps and clears the action-taken workflow columns', async () => {
      const { database, instance } = getTestSQLDatabaseWithInstance()
      await database.migrate()
      try {
        const report = await database.createReport({
          actorId: 'https://test.llun.dev/users/reporter',
          targetActorId: 'https://remote.example/users/spammer'
        })

        expect(
          await database.setReportResolution({
            reportId: report.id,
            resolved: true,
            actionTakenByActorId: 'https://test.llun.dev/users/mod'
          })
        ).toBe(true)
        const resolved = await instance('reports')
          .where('id', report.id)
          .first()
        expect(Boolean(resolved.actionTaken)).toBe(true)
        expect(resolved.actionTakenAt).toBeTruthy()
        expect(resolved.actionTakenByActorId).toBe(
          'https://test.llun.dev/users/mod'
        )

        await database.setReportResolution({
          reportId: report.id,
          resolved: false
        })
        const reopened = await instance('reports')
          .where('id', report.id)
          .first()
        expect(Boolean(reopened.actionTaken)).toBe(false)
        expect(reopened.actionTakenAt).toBeNull()
        expect(reopened.actionTakenByActorId).toBeNull()
      } finally {
        await database.destroy()
      }
    })

    it('returns false for an unknown report id', async () => {
      await withFreshDatabase(async (database) => {
        expect(
          await database.setReportResolution({
            reportId: 'missing',
            resolved: true
          })
        ).toBe(false)
      })
    })
  })
})
