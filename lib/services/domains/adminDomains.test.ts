import { getConfig } from '@/lib/config'
import type { DomainCheckResult } from '@/lib/database/domains/servedDomain/types'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { Database } from '@/lib/database/types'

import {
  addDomain,
  getAdminDomain,
  getAdminDomainList,
  getEnvDomains,
  recheckDomain,
  removeDomain,
  setDomainStatus,
  updateDomainRegistrations
} from './adminDomains'
import {
  getActiveServedDomainNames,
  resetServedDomainsForTests
} from './servedDomainSnapshot'

const baseConfig = vi.mocked(getConfig)()

const PASSED: DomainCheckResult = {
  passed: true,
  reason: 'passed',
  items: [
    { key: 'dns', status: 'passed' },
    { key: 'tls', status: 'passed' },
    { key: 'host', status: 'passed' }
  ]
}

const FAILED: DomainCheckResult = {
  passed: false,
  reason: 'tls',
  items: [
    { key: 'dns', status: 'passed' },
    { key: 'tls', status: 'failed' },
    { key: 'host', status: 'skipped' }
  ]
}

const passes = vi.fn(async () => PASSED)
const fails = vi.fn(async () => FAILED)

const useEnv = (trustedHosts: string[]) => {
  vi.mocked(getConfig).mockReturnValue({
    ...baseConfig,
    host: 'social.example',
    trustedHosts
  })
}

const createLocalActor = (
  database: Database,
  username: string,
  domain: string
) =>
  database.createAccount({
    email: `${username}@mail.example`,
    username,
    domain,
    passwordHash: 'hash',
    privateKey: 'private',
    publicKey: 'public'
  })

describe('adminDomains', () => {
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
    resetServedDomainsForTests()
    useEnv(['club.example', '*.preview.example'])
    for (const row of await database.getServedDomains()) {
      await database.deleteServedDomain({ domain: row.domain })
    }
  })

  afterEach(() => {
    vi.mocked(getConfig).mockReturnValue(baseConfig)
    resetServedDomainsForTests()
  })

  describe('getEnvDomains', () => {
    it('splits the env into the primary, concrete trusted hosts and wildcards', () => {
      useEnv([
        'Club.Example',
        'social.example',
        '*.preview.example',
        ' ',
        'club.example:443'
      ])
      expect(getEnvDomains()).toEqual({
        primary: 'social.example',
        trusted: ['club.example'],
        wildcards: ['*.preview.example']
      })
    })
  })

  describe('addDomain', () => {
    it('normalises the domain and saves it off with the check result', async () => {
      const result = await addDomain(database, 'https://Photos.Example.', fails)
      expect(result).toMatchObject({
        type: 'added',
        domain: {
          domain: 'photos.example',
          source: 'database',
          status: 'off',
          signupsOpen: false,
          allowExistingUsers: false,
          lastCheck: FAILED
        }
      })
      expect(fails).toHaveBeenCalledWith('photos.example')
      expect(getActiveServedDomainNames()).toEqual([])
    })

    it.each([
      ['*.photos.example', 'wildcard'],
      ['not a domain', 'invalid'],
      ['social.example', 'primary'],
      ['CLUB.example', 'env']
    ])('refuses %s (%s) without checking it', async (raw, error) => {
      const check = vi.fn(async () => PASSED)
      await expect(addDomain(database, raw, check)).resolves.toEqual({
        type: 'error',
        error
      })
      expect(check).not.toHaveBeenCalled()
    })

    it('refuses a domain already in the list', async () => {
      await addDomain(database, 'photos.example', passes)
      await expect(
        addDomain(database, 'photos.example', passes)
      ).resolves.toEqual({ type: 'error', error: 'exists' })
    })
  })

  describe('setDomainStatus', () => {
    it('turns a domain on only after a passing check, and trusts it at once', async () => {
      await addDomain(database, 'photos.example', fails)

      const failed = await setDomainStatus(
        database,
        'photos.example',
        'on',
        fails
      )
      expect(failed.type).toBe('check-failed')
      expect(
        (await database.getServedDomain({ domain: 'photos.example' }))?.status
      ).toBe('off')
      expect(getActiveServedDomainNames()).toEqual([])

      const on = await setDomainStatus(database, 'photos.example', 'on', passes)
      expect(on).toMatchObject({
        type: 'updated',
        domain: { status: 'on', lastCheck: PASSED }
      })
      expect(getActiveServedDomainNames()).toEqual(['photos.example'])
    })

    it('stops trusting a domain as soon as it is turned off', async () => {
      await addDomain(database, 'photos.example', passes)
      await setDomainStatus(database, 'photos.example', 'on', passes)
      const check = vi.fn(async () => PASSED)
      const off = await setDomainStatus(
        database,
        'photos.example',
        'off',
        check
      )
      expect(off).toMatchObject({ type: 'updated', domain: { status: 'off' } })
      expect(check).not.toHaveBeenCalled()
      expect(getActiveServedDomainNames()).toEqual([])
    })

    it('locks env domains and reports unknown ones', async () => {
      await expect(
        setDomainStatus(database, 'club.example', 'off', passes)
      ).resolves.toEqual({ type: 'locked' })
      await expect(
        setDomainStatus(database, 'social.example', 'off', passes)
      ).resolves.toEqual({ type: 'locked' })
      await expect(
        setDomainStatus(database, 'nope.example', 'on', passes)
      ).resolves.toEqual({ type: 'not-found' })
    })
  })

  describe('recheckDomain', () => {
    it('stores the new result and leaves the status alone', async () => {
      await addDomain(database, 'photos.example', passes)
      await setDomainStatus(database, 'photos.example', 'on', passes)
      const checked = await recheckDomain(database, 'photos.example', fails)
      expect(checked).toMatchObject({ status: 'on', lastCheck: FAILED })
    })

    it('has nothing to check for an env domain', async () => {
      await expect(
        recheckDomain(database, 'club.example', passes)
      ).resolves.toBeNull()
    })
  })

  describe('updateDomainRegistrations', () => {
    it('saves a database domain’s sign-up settings', async () => {
      await addDomain(database, 'photos.example', passes)
      const result = await updateDomainRegistrations(
        database,
        'photos.example',
        {
          signupsOpen: true,
          allowedEmails: ['ana@mail.example'],
          allowExistingUsers: true
        }
      )
      expect(result).toMatchObject({
        type: 'updated',
        domain: {
          signupsOpen: true,
          allowedEmails: ['ana@mail.example'],
          allowExistingUsers: true,
          status: 'off'
        }
      })
    })

    it('gives an env domain a row that never puts it in trust by itself', async () => {
      const result = await updateDomainRegistrations(database, 'club.example', {
        signupsOpen: true,
        allowExistingUsers: false
      })
      expect(result).toMatchObject({
        type: 'updated',
        domain: {
          source: 'env',
          status: 'on',
          signupsOpen: true,
          allowExistingUsers: true
        }
      })
      const row = await database.getServedDomain({ domain: 'club.example' })
      expect(row).toMatchObject({ status: 'off', allowExistingUsers: false })
      expect(await database.getActiveServedDomains()).toEqual([])
    })

    it('sends the primary to Admin › Instance', async () => {
      await expect(
        updateDomainRegistrations(database, 'social.example', {
          signupsOpen: false
        })
      ).resolves.toEqual({ type: 'primary' })
    })

    it('reports an unknown domain', async () => {
      await expect(
        updateDomainRegistrations(database, 'nope.example', {
          signupsOpen: true
        })
      ).resolves.toEqual({ type: 'not-found' })
    })
  })

  describe('removeDomain', () => {
    it('removes an off domain without profiles', async () => {
      await addDomain(database, 'photos.example', passes)
      await expect(removeDomain(database, 'photos.example')).resolves.toEqual({
        type: 'removed'
      })
      expect(await getAdminDomain(database, 'photos.example')).toBeNull()
    })

    it('refuses a domain that is on, has profiles, or is set in the env', async () => {
      await addDomain(database, 'photos.example', passes)
      await setDomainStatus(database, 'photos.example', 'on', passes)
      await expect(removeDomain(database, 'photos.example')).resolves.toEqual({
        type: 'on'
      })

      await setDomainStatus(database, 'photos.example', 'off', passes)
      await createLocalActor(database, 'pat', 'photos.example')
      await expect(removeDomain(database, 'photos.example')).resolves.toEqual({
        type: 'has-profiles'
      })

      await expect(removeDomain(database, 'club.example')).resolves.toEqual({
        type: 'locked'
      })
    })
  })

  describe('getAdminDomainList', () => {
    it('lists the primary, the env domains, the added ones and the wildcards', async () => {
      await addDomain(database, 'birds.example', fails)
      await createLocalActor(database, 'ana', 'social.example')
      await createLocalActor(database, 'kim', 'club.example')

      const list = await getAdminDomainList(database)
      expect(
        list.domains.map(({ domain, source, status, profiles }) => ({
          domain,
          source,
          status,
          profiles
        }))
      ).toEqual([
        {
          domain: 'social.example',
          source: 'primary',
          status: 'on',
          profiles: 1
        },
        { domain: 'club.example', source: 'env', status: 'on', profiles: 1 },
        {
          domain: 'birds.example',
          source: 'database',
          status: 'off',
          profiles: 0
        }
      ])
      expect(list.domains[0]).toMatchObject({
        name: 'Activities.next',
        signupsOpen: true,
        allowedEmails: []
      })
      expect(list.wildcards).toEqual([{ rule: '*.preview.example' }])
    })

    it('shows a removed env entry’s leftover row as an ordinary off domain', async () => {
      await updateDomainRegistrations(database, 'club.example', {
        signupsOpen: true
      })
      useEnv([])
      const club = await getAdminDomain(database, 'club.example')
      expect(club).toMatchObject({ source: 'database', status: 'off' })
      expect(await database.getActiveServedDomains()).toEqual([])
    })
  })
})
