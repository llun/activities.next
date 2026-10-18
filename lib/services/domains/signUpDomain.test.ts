import { getConfig } from '@/lib/config'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { Database } from '@/lib/database/types'
import { invalidateServerSettingsCache } from '@/lib/services/serverSettings'

import {
  isEmailAllowedForAccount,
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
  })
})
