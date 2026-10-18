import { getConfig } from '@/lib/config'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { Database } from '@/lib/database/types'
import { invalidateServerSettingsCache } from '@/lib/services/serverSettings'
import { logger } from '@/lib/utils/logger'

import {
  isEmailAllowedForAccount,
  isEmailAllowedForSignUpDomain,
  resolveSignUpDomain,
  resolveSignUpOpenSafely
} from './signUpDomain'

const baseConfig = vi.mocked(getConfig)()

describe('signUpDomain', () => {
  const testDb = createTestDatabase()
  let database: Database

  beforeAll(async () => {
    await testDb.prepare()
    await testDb.database.migrate()
    database = testDb.database
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  beforeEach(async () => {
    vi.mocked(getConfig).mockReturnValue({
      ...baseConfig,
      host: 'social.example',
      trustedHosts: ['club.example', '*.preview.example']
    })
    for (const row of await database.getServedDomains()) {
      await database.deleteServedDomain({ domain: row.domain })
    }
    await database.setServerSettings([
      { key: 'registrations.open', value: true },
      { key: 'registrations.allowEmails', value: ['boss@mail.example'] }
    ])
    invalidateServerSettingsCache(database)
  })

  afterEach(() => {
    vi.mocked(getConfig).mockReturnValue(baseConfig)
  })

  describe('resolveSignUpDomain', () => {
    it('uses the server settings and name on the primary', async () => {
      await expect(
        resolveSignUpDomain(database, 'Social.Example')
      ).resolves.toEqual({
        domain: 'social.example',
        displayName: 'Activities.next',
        source: 'primary',
        open: true,
        allowEmails: ['boss@mail.example']
      })
    })

    it('falls back to the primary for a missing host', async () => {
      const result = await resolveSignUpDomain(database, null)
      expect(result.source).toBe('primary')
    })

    it('uses an active row, named after its domain when it has no name', async () => {
      await database.createServedDomain({
        domain: 'run.example',
        status: 'on',
        signupsOpen: true,
        allowedEmails: ['ana@mail.example']
      })
      await expect(
        resolveSignUpDomain(database, 'run.example')
      ).resolves.toEqual({
        domain: 'run.example',
        displayName: 'run.example',
        source: 'database',
        open: true,
        allowEmails: ['ana@mail.example']
      })
    })

    it('is closed on an env domain without a row, a row that is off, and a wildcard host', async () => {
      await database.createServedDomain({
        domain: 'old.example',
        status: 'off',
        signupsOpen: true
      })
      for (const host of [
        'club.example',
        'old.example',
        'pr-1.preview.example'
      ]) {
        const result = await resolveSignUpDomain(database, host)
        expect(result.open).toBe(false)
        expect(result.domain).toBe(host)
      }
    })
  })

  describe('resolveSignUpOpenSafely', () => {
    it('is null without a database', async () => {
      await expect(
        resolveSignUpOpenSafely(null, 'social.example')
      ).resolves.toBeNull()
    })

    // The primary's own setting, the caller's fallback, says nothing about
    // another domain.
    it('logs a failed lookup and reports another domain closed', async () => {
      const getServedDomain = vi
        .spyOn(database, 'getServedDomain')
        .mockRejectedValue(new Error('domains table missing'))
      const loggerError = vi.spyOn(logger, 'error')
      try {
        await expect(
          resolveSignUpOpenSafely(database, 'run.example')
        ).resolves.toBe(false)
        expect(loggerError).toHaveBeenCalledWith(
          expect.objectContaining({
            err: expect.objectContaining({ message: 'domains table missing' })
          })
        )
      } finally {
        getServedDomain.mockRestore()
        loggerError.mockRestore()
      }
    })
  })

  describe('isEmailAllowedForAccount', () => {
    it('allows the server list everywhere, and a domain list for profiles on that domain', async () => {
      const runAccount = await database.createAccount({
        email: 'ana@mail.example',
        username: 'ana',
        domain: 'run.example',
        passwordHash: 'hash',
        privateKey: 'private',
        publicKey: 'public'
      })
      const primaryAccount = await database.createAccount({
        email: 'kim@mail.example',
        username: 'kim',
        domain: 'social.example',
        passwordHash: 'hash',
        privateKey: 'private',
        publicKey: 'public'
      })
      await database.createServedDomain({
        domain: 'run.example',
        status: 'on',
        allowedEmails: ['ana@mail.example']
      })

      await expect(
        isEmailAllowedForAccount(database, 'boss@mail.example', primaryAccount)
      ).resolves.toBe(true)
      await expect(
        isEmailAllowedForAccount(database, 'ana@mail.example', runAccount)
      ).resolves.toBe(true)
      // The run.example list does not reach an account with no profile there.
      await expect(
        isEmailAllowedForAccount(database, 'kim@mail.example', primaryAccount)
      ).resolves.toBe(false)

      // Turned off, the domain's list no longer counts.
      await database.updateServedDomain({
        domain: 'run.example',
        status: 'off'
      })
      await expect(
        isEmailAllowedForAccount(database, 'ana@mail.example', runAccount)
      ).resolves.toBe(false)
    })

    it('uses the list of an env domain, whose row is stored off', async () => {
      const accountId = await database.createAccount({
        email: 'eve@mail.example',
        username: 'eve-club',
        domain: 'club.example',
        passwordHash: 'hash',
        privateKey: 'private',
        publicKey: 'public'
      })
      await database.createServedDomain({
        domain: 'club.example',
        status: 'off',
        allowedEmails: ['eve@mail.example']
      })
      await expect(
        isEmailAllowedForAccount(database, 'eve@mail.example', accountId)
      ).resolves.toBe(true)
    })

    // Closing sign-ups on the domain an account signed up on stops newcomers;
    // it must not lock out the people already there, as on the primary.
    it.each([
      {
        description:
          'is allowed on its closed sign-up domain with an empty list',
        signupsOpen: false
      },
      {
        description: 'is allowed on its open sign-up domain with an empty list',
        signupsOpen: true
      }
    ])(
      'an address off the primary list $description',
      async ({ signupsOpen }) => {
        const username = `lee-${signupsOpen ? 'open' : 'closed'}`
        const domain = `${username}.example`
        const accountId = await database.createAccount({
          email: `${username}@mail.example`,
          username,
          domain,
          passwordHash: 'hash',
          privateKey: 'private',
          publicKey: 'public'
        })
        await database.createServedDomain({ domain, status: 'on', signupsOpen })
        await expect(
          isEmailAllowedForAccount(database, 'removed@mail.example', accountId)
        ).resolves.toBe(true)
      }
    )

    it('keeps an account in after sign-ups close on the domain it signed up on', async () => {
      const accountId = await database.createAccount({
        email: 'ray@mail.example',
        username: 'ray',
        domain: 'shut.example',
        passwordHash: 'hash',
        privateKey: 'private',
        publicKey: 'public'
      })
      await database.createServedDomain({
        domain: 'shut.example',
        status: 'on',
        signupsOpen: true
      })
      await expect(
        isEmailAllowedForAccount(database, 'ray@mail.example', accountId)
      ).resolves.toBe(true)

      await database.updateServedDomain({
        domain: 'shut.example',
        signupsOpen: false
      })
      await expect(
        isEmailAllowedForAccount(database, 'ray@mail.example', accountId)
      ).resolves.toBe(true)
    })

    // A new row (and an env domain's first Registrations save) is closed with
    // an empty list; on a domain the account only added a profile on, that must
    // not read as "anyone".
    it('refuses an address off the primary list on a closed domain it only added a profile on', async () => {
      const accountId = await database.createAccount({
        email: 'max@mail.example',
        username: 'max',
        domain: 'social.example',
        passwordHash: 'hash',
        privateKey: 'private',
        publicKey: 'public'
      })
      // Sorts after social.example, so it stays the second actor even when
      // both share a createdAt.
      await database.createActorForAccount({
        accountId,
        username: 'max',
        domain: 'tide.example',
        privateKey: 'private',
        publicKey: 'public'
      })
      await database.createServedDomain({
        domain: 'tide.example',
        status: 'on',
        signupsOpen: false
      })
      await expect(
        isEmailAllowedForAccount(database, 'max@mail.example', accountId)
      ).resolves.toBe(false)
    })
  })

  describe('isEmailAllowedForSignUpDomain', () => {
    beforeEach(async () => {
      // An empty server list: anyone on the primary.
      await database.setServerSettings([
        { key: 'registrations.allowEmails', value: [] }
      ])
      invalidateServerSettingsCache(database)
    })

    it.each([
      {
        description: 'the server list on the primary',
        domain: 'social.example',
        status: 'on' as const,
        email: 'anyone@mail.example',
        expected: true
      },
      {
        description: 'the domain list on an added domain',
        domain: 'run.example',
        status: 'on' as const,
        email: 'ana@mail.example',
        expected: true
      },
      {
        description:
          'an address the added domain refuses, though the server list is empty',
        domain: 'run.example',
        status: 'on' as const,
        email: 'bob@mail.example',
        expected: false
      },
      {
        description: 'any address once the added domain is off',
        domain: 'run.example',
        status: 'off' as const,
        email: 'ana@mail.example',
        expected: false
      },
      {
        description: 'any address on a domain with no row',
        domain: 'gone.example',
        status: 'on' as const,
        email: 'ana@mail.example',
        expected: false
      }
    ])('checks $description', async ({ domain, status, email, expected }) => {
      await database.createServedDomain({
        domain: 'run.example',
        status,
        signupsOpen: true,
        allowedEmails: ['ana@mail.example']
      })
      await expect(
        isEmailAllowedForSignUpDomain(database, email, domain)
      ).resolves.toBe(expected)
    })

    // The primary's list ignores registrations.open, as at sign-in.
    it('checks the server list on the primary with sign-ups closed', async () => {
      await database.setServerSettings([
        { key: 'registrations.open', value: false }
      ])
      invalidateServerSettingsCache(database)
      await expect(
        isEmailAllowedForSignUpDomain(
          database,
          'anyone@mail.example',
          'social.example'
        )
      ).resolves.toBe(true)
    })
  })
})
