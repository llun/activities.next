import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { Database } from '@/lib/database/types'
import { logger } from '@/lib/utils/logger'

const withFreshDatabase = async (
  test: (database: Database) => Promise<void>
) => {
  const testDb = createTestDatabase()
  await testDb.prepare()
  await testDb.database.migrate()
  try {
    await test(testDb.database)
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
  // as a list closes sign-ups instead of opening them.
  it.each([
    { description: 'is not JSON', stored: 'not json' },
    { description: 'is not a list', stored: '{"ana@mail.example":true}' }
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
      ).resolves.toMatchObject({ signupsOpen: false, allowedEmails: [] })
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
