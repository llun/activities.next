import {
  databaseBeforeAll,
  getTestDatabaseTable,
  getTestSQLDatabase,
  getTestSQLDatabaseWithInstance
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'

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
})
