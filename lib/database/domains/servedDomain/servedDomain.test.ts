import type { Db } from '@/lib/database/kysely'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { Database } from '@/lib/database/types'
import { logger } from '@/lib/utils/logger'

const withFreshDatabase = async (
  test: (database: Database, db: Db) => Promise<void>
) => {
  const testDb = createTestDatabase()
  await testDb.prepare()
  await testDb.database.migrate()
  try {
    await test(testDb.database, testDb.db)
  } finally {
    await testDb.destroy()
  }
}

const FAILED_CHECK = {
  passed: false,
  reason: 'tls' as const,
  items: [
    { key: 'dns' as const, status: 'passed' as const },
    { key: 'tls' as const, status: 'failed' as const },
    { key: 'host' as const, status: 'skipped' as const }
  ]
}

describe('createServedDomain', () => {
  it('creates an off row with closed sign-ups and the check result', async () => {
    await withFreshDatabase(async (database) => {
      const created = await database.createServedDomain({
        domain: 'run.example',
        check: FAILED_CHECK
      })

      expect(created).toMatchObject({
        domain: 'run.example',
        status: 'off',
        name: null,
        signupsOpen: false,
        allowedEmails: [],
        allowExistingUsers: false,
        lastCheckStatus: 'failed',
        lastCheckResult: FAILED_CHECK
      })
      expect(typeof created.lastCheckedAt).toBe('number')
      expect(typeof created.createdAt).toBe('number')
      expect(await database.getServedDomains()).toEqual([created])
    })
  })

  it('stores no check when none is given', async () => {
    await withFreshDatabase(async (database) => {
      const created = await database.createServedDomain({
        domain: 'club.example',
        signupsOpen: true,
        allowedEmails: ['ana@mail.example']
      })
      expect(created.lastCheckedAt).toBeNull()
      expect(created.lastCheckStatus).toBeNull()
      expect(created.lastCheckResult).toBeNull()
      expect(created.signupsOpen).toBe(true)
      expect(created.allowedEmails).toEqual(['ana@mail.example'])
    })
  })

  it('rejects a duplicate domain', async () => {
    await withFreshDatabase(async (database) => {
      await database.createServedDomain({ domain: 'run.example' })
      await expect(
        database.createServedDomain({ domain: 'run.example' })
      ).rejects.toThrow()
    })
  })
})

describe('getServedDomain', () => {
  // An empty list means "anyone may sign up", so a value that cannot be read
  // as a list closes sign-ups instead of opening them, and reads back as null
  // rather than empty.
  it.each([
    { description: 'is not JSON', stored: 'not json' },
    { description: 'is not a list', stored: '{"ana@mail.example":true}' },
    { description: 'is empty', stored: '' },
    { description: 'holds a non-string item', stored: '[123]' }
  ])('closes sign-ups when allowedEmails $description', async ({ stored }) => {
    const testDb = createTestDatabase()
    await testDb.prepare()
    await testDb.database.migrate()
    const loggerError = vi.spyOn(logger, 'error')
    try {
      await testDb.database.createServedDomain({
        domain: 'club.example',
        status: 'on',
        signupsOpen: true,
        allowedEmails: ['ana@mail.example']
      })
      await testDb.db
        .updateTable('domains')
        .set({ allowedEmails: stored })
        .where('domain', '=', 'club.example')
        .execute()

      await expect(
        testDb.database.getServedDomain({ domain: 'club.example' })
      ).resolves.toMatchObject({ signupsOpen: false, allowedEmails: null })
      expect(loggerError).toHaveBeenCalledWith(
        expect.objectContaining({ domain: 'club.example' })
      )
    } finally {
      loggerError.mockRestore()
      await testDb.destroy()
    }
  })
})

describe('updateServedDomain', () => {
  it('updates only the given fields', async () => {
    await withFreshDatabase(async (database) => {
      await database.createServedDomain({ domain: 'run.example' })
      const updated = await database.updateServedDomain({
        domain: 'run.example',
        status: 'on',
        signupsOpen: true,
        allowedEmails: ['ana@mail.example', 'ben@mail.example'],
        allowExistingUsers: true
      })
      expect(updated).toMatchObject({
        status: 'on',
        signupsOpen: true,
        allowedEmails: ['ana@mail.example', 'ben@mail.example'],
        allowExistingUsers: true,
        lastCheckStatus: null
      })

      const checked = await database.updateServedDomain({
        domain: 'run.example',
        check: { passed: true, reason: 'passed', items: [] }
      })
      expect(checked?.lastCheckStatus).toBe('passed')
      expect(checked?.signupsOpen).toBe(true)
    })
  })

  it('returns null for an unknown domain', async () => {
    await withFreshDatabase(async (database) => {
      expect(
        await database.updateServedDomain({ domain: 'nope.example' })
      ).toBeNull()
    })
  })
})

describe('identity and policies', () => {
  const IDENTITY = {
    name: 'Run Club',
    description: 'Running together',
    contactEmail: 'hello@run.example',
    termsOfService: '# Terms',
    termsOfServiceUpdatedAt: Date.UTC(2026, 0, 2, 3, 4, 5),
    privacyPolicy: '# Privacy',
    privacyPolicyUpdatedAt: Date.UTC(2026, 5, 6, 7, 8, 9)
  }

  it('round-trips every identity and policy column', async () => {
    await withFreshDatabase(async (database) => {
      const created = await database.createServedDomain({
        domain: 'run.example',
        status: 'on',
        ...IDENTITY
      })
      expect(created).toMatchObject({
        name: 'Run Club',
        description: 'Running together',
        contactEmail: 'hello@run.example'
      })

      await expect(
        database.getServedDomainWithPolicies({ domain: 'run.example' })
      ).resolves.toMatchObject({ domain: 'run.example', ...IDENTITY })

      await database.updateServedDomain({
        domain: 'run.example',
        description: null,
        termsOfService: null,
        termsOfServiceUpdatedAt: null,
        privacyPolicy: '# Privacy, revised',
        privacyPolicyUpdatedAt: Date.UTC(2026, 7, 1)
      })
      await expect(
        database.getServedDomainWithPolicies({ domain: 'run.example' })
      ).resolves.toMatchObject({
        name: 'Run Club',
        description: null,
        contactEmail: 'hello@run.example',
        termsOfService: null,
        termsOfServiceUpdatedAt: null,
        privacyPolicy: '# Privacy, revised',
        privacyPolicyUpdatedAt: Date.UTC(2026, 7, 1)
      })
    })
  })

  it('defaults every override to null', async () => {
    await withFreshDatabase(async (database) => {
      await database.createServedDomain({ domain: 'run.example' })
      await expect(
        database.getServedDomainWithPolicies({ domain: 'run.example' })
      ).resolves.toMatchObject({
        name: null,
        description: null,
        contactEmail: null,
        termsOfService: null,
        termsOfServiceUpdatedAt: null,
        privacyPolicy: null,
        privacyPolicyUpdatedAt: null
      })
      await expect(
        database.getServedDomainWithPolicies({ domain: 'nope.example' })
      ).resolves.toBeNull()
    })
  })

  it('leaves the policy texts out of the single read and the lists', async () => {
    await withFreshDatabase(async (database) => {
      await database.createServedDomain({
        domain: 'run.example',
        status: 'on',
        ...IDENTITY
      })
      const rows = [
        await database.getServedDomain({ domain: 'run.example' }),
        ...(await database.getServedDomains()),
        ...(await database.getActiveServedDomains())
      ]
      expect(rows).toHaveLength(3)
      for (const row of rows) {
        expect(row).toMatchObject({ description: 'Running together' })
        expect(row).not.toHaveProperty('termsOfService')
        expect(row).not.toHaveProperty('privacyPolicy')
        expect(row).not.toHaveProperty('termsOfServiceUpdatedAt')
        expect(row).not.toHaveProperty('privacyPolicyUpdatedAt')
      }
    })
  })
})

describe('disabled features', () => {
  it('defaults to none and round-trips a list, which an empty list clears', async () => {
    await withFreshDatabase(async (database) => {
      const created = await database.createServedDomain({
        domain: 'run.example'
      })
      expect(created.disabledFeatures).toEqual([])

      const updated = await database.updateServedDomain({
        domain: 'run.example',
        disabledFeatures: ['messages', 'fitness']
      })
      // Read back in the registry's order.
      expect(updated?.disabledFeatures).toEqual(['fitness', 'messages'])
      expect(
        (await database.getServedDomainWithPolicies({ domain: 'run.example' }))
          ?.disabledFeatures
      ).toEqual(['fitness', 'messages'])
      expect((await database.getActiveServedDomains()).length).toBe(0)

      // Other updates leave the list alone.
      const renamed = await database.updateServedDomain({
        domain: 'run.example',
        name: 'Run Club'
      })
      expect(renamed?.disabledFeatures).toEqual(['fitness', 'messages'])

      const cleared = await database.updateServedDomain({
        domain: 'run.example',
        disabledFeatures: []
      })
      expect(cleared?.disabledFeatures).toEqual([])
      const again = await database.updateServedDomain({
        domain: 'run.example',
        disabledFeatures: ['explore']
      })
      expect(again?.disabledFeatures).toEqual(['explore'])
      expect(
        (
          await database.updateServedDomain({
            domain: 'run.example',
            disabledFeatures: null
          })
        )?.disabledFeatures
      ).toEqual([])
    })
  })

  it('reads an unreadable stored value as none', async () => {
    const testDb = createTestDatabase()
    await testDb.prepare()
    await testDb.database.migrate()
    try {
      await testDb.database.createServedDomain({ domain: 'run.example' })
      await testDb.db
        .updateTable('domains')
        .set({ disabledFeatures: '{"not":"a list"}' })
        .execute()
      expect(
        (await testDb.database.getServedDomain({ domain: 'run.example' }))
          ?.disabledFeatures
      ).toEqual([])

      await testDb.db
        .updateTable('domains')
        .set({ disabledFeatures: '["explore","unknown","explore"]' })
        .execute()
      expect(
        (await testDb.database.getServedDomain({ domain: 'run.example' }))
          ?.disabledFeatures
      ).toEqual(['explore'])
    } finally {
      await testDb.destroy()
    }
  })
})

describe('getActiveServedDomains', () => {
  it('returns only rows that are on, in domain order', async () => {
    await withFreshDatabase(async (database) => {
      await database.createServedDomain({ domain: 'run.example', status: 'on' })
      await database.createServedDomain({ domain: 'birds.example' })
      await database.createServedDomain({ domain: 'art.example', status: 'on' })

      const active = await database.getActiveServedDomains()
      expect(active.map((row) => row.domain)).toEqual([
        'art.example',
        'run.example'
      ])
    })
  })
})

describe('deleteServedDomain', () => {
  it('removes a row and reports unknown domains', async () => {
    await withFreshDatabase(async (database) => {
      await database.createServedDomain({ domain: 'run.example' })
      expect(await database.deleteServedDomain({ domain: 'run.example' })).toBe(
        true
      )
      expect(await database.getServedDomain({ domain: 'run.example' })).toBe(
        null
      )
      expect(await database.deleteServedDomain({ domain: 'run.example' })).toBe(
        false
      )
    })
  })
})

describe('countLocalActorsByDomain', () => {
  it('counts local actors with an account per requested domain', async () => {
    await withFreshDatabase(async (database) => {
      await database.createAccount({
        email: 'ana@mail.example',
        username: 'ana',
        domain: 'run.example',
        privateKey: 'private',
        publicKey: 'public',
        passwordHash: 'hash'
      })
      await database.createAccount({
        email: 'ben@mail.example',
        username: 'ben',
        domain: 'run.example',
        privateKey: 'private',
        publicKey: 'public',
        passwordHash: 'hash'
      })
      await database.createAccount({
        email: 'cat@mail.example',
        username: 'cat',
        domain: 'social.example',
        privateKey: 'private',
        publicKey: 'public',
        passwordHash: 'hash'
      })

      expect(
        await database.countLocalActorsByDomain({
          domains: ['run.example', 'birds.example']
        })
      ).toEqual({ 'run.example': 2 })
      expect(await database.countLocalActorsByDomain({ domains: [] })).toEqual(
        {}
      )
    })
  })
})

// The actors that block turning a domain off or removing it: a local
// account-backed actor matches by its current handle's domain OR by the host
// of its immutable actor id, so a renamed actor blocks both its old and its
// new domain.
describe('getLocalActorsOnDomain', () => {
  const createLocalAccount = async (
    database: Database,
    username: string,
    domain: string
  ) => {
    const accountId = await database.createAccount({
      email: `${username}-${crypto.randomUUID()}@mail.example`,
      username,
      passwordHash: 'hash',
      domain,
      privateKey: `private-${username}`,
      publicKey: `public-${username}`
    })
    const actors = await database.getActorsForAccount({ accountId })
    return actors[0]
  }

  const createRemoteActor = async (
    database: Database,
    username: string,
    domain: string
  ) => {
    const actorId = `https://${domain}/users/${username}`
    await database.createActor({
      actorId,
      username,
      domain,
      followersUrl: `${actorId}/followers`,
      inboxUrl: `${actorId}/inbox`,
      sharedInboxUrl: `https://${domain}/inbox`,
      publicKey: 'public-key',
      createdAt: Date.now()
    })
    return actorId
  }

  const renameTo = (
    database: Database,
    actorId: string,
    username: string,
    domain: string
  ) =>
    database.recordActorHandleRename({
      actorId,
      username,
      domain,
      now: new Date('2026-01-01T00:00:00.000Z'),
      cooldownMs: 30 * 24 * 60 * 60 * 1000
    })

  it('matches the id host after a rename away and the handle domain, and excludes remote actors', async () => {
    await withFreshDatabase(async (database) => {
      const alice = await createLocalAccount(database, 'alice', 'old.example')
      await renameTo(database, alice.id, 'alice', 'new.example')
      await createLocalAccount(database, 'ben', 'other.example')
      await createRemoteActor(database, 'visitor', 'old.example')

      // The actor renamed AWAY: its handle is on new.example now, but its
      // id still names old.example, so both domains are blocked.
      expect(
        await database.getLocalActorsOnDomain({ domain: 'old.example' })
      ).toEqual([{ id: alice.id, username: 'alice', domain: 'new.example' }])
      expect(
        await database.getLocalActorsOnDomain({ domain: 'new.example' })
      ).toEqual([{ id: alice.id, username: 'alice', domain: 'new.example' }])
      expect(
        await database.getLocalActorsOnDomain({ domain: 'empty.example' })
      ).toEqual([])
    })
  })

  it('matches an actor renamed ONTO the domain by both arms, once', async () => {
    await withFreshDatabase(async (database) => {
      const bob = await createLocalAccount(database, 'bob', 'old.example')
      await renameTo(database, bob.id, 'bob', 'new.example')

      // Handle domain and id host are both new.example here; the actor is
      // returned once.
      expect(
        await database.getLocalActorsOnDomain({ domain: 'new.example' })
      ).toEqual([{ id: bob.id, username: 'bob', domain: 'new.example' }])
    })
  })

  it('orders by username then id', async () => {
    await withFreshDatabase(async (database) => {
      await createLocalAccount(database, 'zoe', 'run.example')
      await createLocalAccount(database, 'ana', 'run.example')

      expect(
        (await database.getLocalActorsOnDomain({ domain: 'run.example' })).map(
          (actor) => actor.username
        )
      ).toEqual(['ana', 'zoe'])
    })
  })

  it('escapes LIKE wildcards in the domain and folds case on both arms', async () => {
    await withFreshDatabase(async (database, db) => {
      const underscore = await createLocalAccount(
        database,
        'carol',
        'a_b.example'
      )
      await createLocalAccount(database, 'dan', 'axb.example')

      // Without escaping, the `_` wildcard would make `a_b.example` match
      // dan's id host too.
      expect(
        await database.getLocalActorsOnDomain({ domain: 'a_b.example' })
      ).toEqual([
        { id: underscore.id, username: 'carol', domain: 'a_b.example' }
      ])

      // The query folds, and so does the stored data: an id or a handle
      // stored in another case still matches its lowercase spelling. The
      // domain update targets the id just written.
      await db
        .updateTable('actors')
        .set({ id: 'https://a_b.EXAMPLE/users/carol' })
        .where('id', '=', underscore.id)
        .execute()
      await db
        .updateTable('actors')
        .set({ domain: 'A_B.example' })
        .where('id', '=', 'https://a_b.EXAMPLE/users/carol')
        .execute()
      expect(
        await database.getLocalActorsOnDomain({ domain: 'A_B.EXAMPLE' })
      ).toEqual([
        {
          id: 'https://a_b.EXAMPLE/users/carol',
          username: 'carol',
          domain: 'A_B.example'
        }
      ])
    })
  })

  it('counts on the same match the refusal uses', async () => {
    await withFreshDatabase(async (database) => {
      const alice = await createLocalAccount(database, 'alice', 'old.example')
      await renameTo(database, alice.id, 'alice', 'new.example')
      await createRemoteActor(database, 'visitor', 'old.example')

      expect(
        await database.countLocalActorsByDomain({
          domains: ['old.example', 'new.example', 'empty.example']
        })
      ).toEqual({ 'old.example': 1, 'new.example': 1 })
    })
  })
})
