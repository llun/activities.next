import { getConfig } from '@/lib/config'
import type { DomainCheckResult } from '@/lib/database/domains/servedDomain/types'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { Database } from '@/lib/database/types'
import { createDeferred } from '@/lib/testing/deferred'
import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'

import {
  addDomain,
  getAdminDomain,
  getAdminDomainList,
  getEnvDomains,
  getServerIdentityView,
  recheckDomain,
  removeDomain,
  setDomainStatus,
  updateDomainSettings
} from './adminDomains'
import { getDomainCheckProof } from './domainCheck'
import * as identityCache from './domainIdentityCache'
import {
  getActiveServedDomainNames,
  refreshServedDomains,
  resetServedDomainsForTests
} from './servedDomainSnapshot'

vi.mock('@/lib/utils/safeRemoteFetch', () => ({ safeRemoteFetch: vi.fn() }))

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
  // A fresh database per test: profiles one test creates must not change what
  // another counts.
  let testDb: ReturnType<typeof createTestDatabase>
  let database: Database

  beforeEach(async () => {
    testDb = createTestDatabase()
    await testDb.prepare()
    await testDb.database.migrate()
    database = testDb.database
    resetServedDomainsForTests()
    useEnv(['club.example', '*.preview.example'])
    vi.mocked(safeRemoteFetch).mockReset()
  })

  afterEach(async () => {
    vi.mocked(getConfig).mockReturnValue(baseConfig)
    resetServedDomainsForTests()
    await testDb.destroy()
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

    // The primary is read the way a trusted host is, so a URL-shaped
    // ACTIVITIES_HOST is still the primary to every helper.
    it('reads a URL-shaped ACTIVITIES_HOST as the primary', () => {
      expect(
        getEnvDomains({
          host: 'https://Social.Example/',
          trustedHosts: ['social.example']
        })
      ).toEqual({ primary: 'social.example', trusted: [], wildcards: [] })
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

    // The default check knows the env domains, so a proof signed for one of
    // them reads as "the proxy dropped the Host header", not another server.
    it('checks with the env domains as the known hosts by default', async () => {
      vi.mocked(safeRemoteFetch).mockImplementation(async ({ url }) => {
        const nonce = new URL(url).searchParams.get('nonce') ?? ''
        return {
          statusCode: 200,
          body: JSON.stringify({
            proof: getDomainCheckProof(nonce, 'club.example')
          })
        } as Awaited<ReturnType<typeof safeRemoteFetch>>
      })
      const result = await addDomain(database, 'photos.example')
      expect(result).toMatchObject({
        type: 'added',
        domain: { lastCheck: { passed: false, reason: 'host-header' } }
      })
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

    // A refresh that began before the write may have read the table before it
    // committed; turning the domain off must not just join it.
    it('stops trusting a domain turned off while a refresh is in flight', async () => {
      await addDomain(database, 'photos.example', passes)
      await setDomainStatus(database, 'photos.example', 'on', passes)
      expect(getActiveServedDomainNames()).toEqual(['photos.example'])

      const beforeWrite = createDeferred<{ domain: string }[]>()
      vi.spyOn(database, 'getActiveServedDomains').mockReturnValueOnce(
        beforeWrite.promise as ReturnType<Database['getActiveServedDomains']>
      )
      const inflight = refreshServedDomains(database)
      const update = database.updateServedDomain.bind(database)
      vi.spyOn(database, 'updateServedDomain').mockImplementation(
        async (params) => {
          const row = await update(params)
          // Settle the old read only once the write is done and its refresh
          // has started, as a slow read would.
          setTimeout(() => beforeWrite.resolve([{ domain: 'photos.example' }]))
          return row
        }
      )

      await setDomainStatus(database, 'photos.example', 'off', passes)
      await inflight
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

    // With its sign-up row in place, so only the env guard can answer null.
    it('has nothing to check for an env domain', async () => {
      await updateDomainSettings(database, 'club.example', {
        signupsOpen: true
      })
      const check = vi.fn(async () => PASSED)
      await expect(
        recheckDomain(database, 'club.example', check)
      ).resolves.toBeNull()
      expect(check).not.toHaveBeenCalled()
    })
  })

  describe('updateDomainSettings', () => {
    it('saves a database domain’s sign-up settings', async () => {
      await addDomain(database, 'photos.example', passes)
      const result = await updateDomainSettings(database, 'photos.example', {
        signupsOpen: true,
        allowedEmails: ['ana@mail.example'],
        allowExistingUsers: true
      })
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
      const result = await updateDomainSettings(database, 'club.example', {
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
        updateDomainSettings(database, 'social.example', {
          signupsOpen: false
        })
      ).resolves.toEqual({ type: 'primary' })
    })

    it('reports an unknown domain', async () => {
      await expect(
        updateDomainSettings(database, 'nope.example', {
          signupsOpen: true
        })
      ).resolves.toEqual({ type: 'not-found' })
    })
  })

  describe('updateDomainSettings: identity and policies', () => {
    it('saves an added domain’s identity and policies, and null means Same as server', async () => {
      await addDomain(database, 'photos.example', passes)
      const saved = await updateDomainSettings(database, 'photos.example', {
        name: 'Photos',
        description: 'Pictures',
        contactEmail: 'hello@photos.example',
        termsOfService: '# Terms',
        privacyPolicy: '# Privacy'
      })
      expect(saved).toMatchObject({
        type: 'updated',
        domain: {
          name: 'Photos',
          description: 'Pictures',
          contactEmail: 'hello@photos.example',
          termsOfService: '# Terms',
          privacyPolicy: '# Privacy'
        }
      })

      const cleared = await updateDomainSettings(database, 'photos.example', {
        description: null,
        privacyPolicy: null
      })
      expect(cleared).toMatchObject({
        type: 'updated',
        domain: {
          name: 'Photos',
          description: null,
          termsOfService: '# Terms',
          privacyPolicy: null,
          privacyPolicyUpdatedAt: null
        }
      })
    })

    it('moves a policy’s date only when its text changes', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      try {
        await addDomain(database, 'photos.example', passes)
        vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
        await updateDomainSettings(database, 'photos.example', {
          termsOfService: '# Terms'
        })

        vi.setSystemTime(new Date('2026-02-01T00:00:00.000Z'))
        // The Policies box sends both texts; only the edited one moves.
        const result = await updateDomainSettings(database, 'photos.example', {
          termsOfService: '# Terms',
          privacyPolicy: '# Privacy'
        })
        expect(result).toMatchObject({
          type: 'updated',
          domain: {
            termsOfServiceUpdatedAt: Date.UTC(2026, 0, 1),
            privacyPolicyUpdatedAt: Date.UTC(2026, 1, 1)
          }
        })

        vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'))
        const edited = await updateDomainSettings(database, 'photos.example', {
          termsOfService: '# Terms, revised'
        })
        expect(edited).toMatchObject({
          domain: { termsOfServiceUpdatedAt: Date.UTC(2026, 2, 1) }
        })
      } finally {
        vi.useRealTimers()
      }
    })

    it('creates an env domain’s row, stored off, on its first identity save', async () => {
      const result = await updateDomainSettings(database, 'club.example', {
        name: 'Club',
        termsOfService: 'Club terms'
      })
      expect(result).toMatchObject({
        type: 'updated',
        domain: {
          source: 'env',
          status: 'on',
          name: 'Club',
          termsOfService: 'Club terms'
        }
      })
      expect(
        typeof (result as { domain: { termsOfServiceUpdatedAt: unknown } })
          .domain.termsOfServiceUpdatedAt
      ).toBe('number')
      await expect(
        database.getServedDomain({ domain: 'club.example' })
      ).resolves.toMatchObject({ status: 'off', name: 'Club' })
      expect(await database.getActiveServedDomains()).toEqual([])
    })

    it('refuses the primary', async () => {
      await expect(
        updateDomainSettings(database, 'social.example', { name: 'Social' })
      ).resolves.toEqual({ type: 'primary' })
    })

    it('invalidates the identity cache on every domain write', async () => {
      const invalidate = vi.spyOn(
        identityCache,
        'invalidateDomainIdentityCache'
      )
      try {
        await addDomain(database, 'photos.example', passes)
        await updateDomainSettings(database, 'photos.example', { name: 'P' })
        expect(invalidate).toHaveBeenCalledTimes(1)
        await setDomainStatus(database, 'photos.example', 'on', passes)
        expect(invalidate).toHaveBeenCalledTimes(2)
        await setDomainStatus(database, 'photos.example', 'off', passes)
        expect(invalidate).toHaveBeenCalledTimes(3)
        await removeDomain(database, 'photos.example')
        expect(invalidate).toHaveBeenCalledTimes(4)
        expect(invalidate).toHaveBeenCalledWith(database)
      } finally {
        invalidate.mockRestore()
      }
    })

    it('returns the detail of a domain with nulls for Same as server', async () => {
      await expect(
        getAdminDomain(database, 'social.example')
      ).resolves.toMatchObject({
        source: 'primary',
        description: null,
        contactEmail: null,
        termsOfService: null,
        privacyPolicy: null,
        termsOfServiceUpdatedAt: null,
        privacyPolicyUpdatedAt: null
      })
      await expect(
        getAdminDomain(database, 'club.example')
      ).resolves.toMatchObject({ source: 'env', termsOfService: null })
    })
  })

  describe('getServerIdentityView', () => {
    it('says whether the server has policies without their texts', async () => {
      await database.setServerSettings([
        { key: 'policies.termsOfService', value: '# Server terms' }
      ])
      const { invalidateServerSettingsCache } =
        await import('@/lib/services/serverSettings')
      invalidateServerSettingsCache(database)

      const view = await getServerIdentityView(database)
      expect(view).toMatchObject({
        name: 'Activities.next',
        description: 'Personal activity pub server with Next.js',
        contactAccount: null,
        terms: { set: true },
        privacy: { set: false, updatedAt: null }
      })
      expect(typeof view.terms.updatedAt).toBe('number')
      expect(JSON.stringify(view)).not.toContain('Server terms')
      invalidateServerSettingsCache(database)
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

    it('takes the domain’s own rules and announcements with it, and no others', async () => {
      await addDomain(database, 'photos.example', passes)
      await database.createServedDomain({ domain: 'birds.example' })
      const server = await database.createInstanceRule({
        text: 'Server',
        hint: ''
      })
      const birds = await database.createInstanceRule({
        domain: 'birds.example',
        text: 'Birds',
        hint: ''
      })
      await database.createInstanceRule({
        domain: 'photos.example',
        text: 'Photos',
        hint: ''
      })
      const everywhere = await database.createAnnouncement({ text: 'All' })
      const birdsNote = await database.createAnnouncement({
        text: 'Birds',
        domain: 'birds.example'
      })
      await database.createAnnouncement({
        text: 'Photos',
        domain: 'photos.example'
      })

      await removeDomain(database, 'photos.example')

      expect(
        (await database.getAllInstanceRules()).map((rule) => rule.id).sort()
      ).toEqual([server.id, birds.id].sort())
      expect(
        (await database.getAnnouncements()).map((a) => a.id).sort()
      ).toEqual([everywhere.id, birdsNote.id].sort())

      await database.deleteInstanceRule({ id: server.id })
      await database.deleteInstanceRule({ id: birds.id })
      await database.deleteAnnouncement({ id: everywhere.id })
      await database.deleteAnnouncement({ id: birdsNote.id })
      await database.deleteServedDomain({ domain: 'birds.example' })
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
      await updateDomainSettings(database, 'club.example', {
        signupsOpen: true
      })
      useEnv([])
      const club = await getAdminDomain(database, 'club.example')
      expect(club).toMatchObject({ source: 'database', status: 'off' })
      expect(await database.getActiveServedDomains()).toEqual([])
    })
  })
})
