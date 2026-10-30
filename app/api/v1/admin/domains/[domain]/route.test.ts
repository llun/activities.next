import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import {
  ADMIN_DOMAIN_FIELD_LIMITS,
  PRIMARY_DOMAIN_FEATURES_ERROR,
  PRIMARY_DOMAIN_IDENTITY_ERROR
} from '@/lib/services/domains/adminDomainTypes'
import { resolveDomainIdentity } from '@/lib/services/domains/domainIdentity'
import {
  resetServedDomainsForTests,
  setServedDomainsForTests
} from '@/lib/services/domains/servedDomainSnapshot'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

import { DELETE, GET, PATCH } from './route'

const holder = vi.hoisted(() => ({ db: null as Database | null }))

vi.mock('@/lib/database', () => ({
  getDatabase: () => holder.db
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi
    .fn()
    .mockResolvedValue({ user: { email: 'admin@social.example' } })
}))

vi.mock('@/lib/utils/getAdminFromSession', () => ({
  getAdminFromSession: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: () => 'https://social.example',
  getConfig: () => ({
    host: 'social.example',
    allowEmails: [],
    trustedHosts: ['club.example'],
    secretPhase: 'secret'
  })
}))

const ORIGIN = 'https://social.example'

const url = (domain: string) =>
  `${ORIGIN}/api/v1/admin/domains/${encodeURIComponent(domain)}`

const patch = (domain: string, body: unknown) =>
  PATCH(
    new NextRequest(url(domain), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify(body)
    }),
    { params: Promise.resolve({ domain: encodeURIComponent(domain) }) }
  )

const get = (domain: string) =>
  GET(new NextRequest(url(domain)), {
    params: Promise.resolve({ domain: encodeURIComponent(domain) })
  })

const del = (domain: string) =>
  DELETE(
    new NextRequest(url(domain), {
      method: 'DELETE',
      headers: { Origin: ORIGIN }
    }),
    { params: Promise.resolve({ domain: encodeURIComponent(domain) }) }
  )

describe('/api/v1/admin/domains/:domain identity and policies', () => {
  beforeEach(async () => {
    vi.mocked(getAdminFromSession).mockResolvedValue({
      id: 'admin',
      defaultActorId: null
    } as never)
    resetServedDomainsForTests()
    holder.db = getTestSQLDatabase()
    await holder.db.migrate()
    await holder.db.createServedDomain({ domain: 'run.example', status: 'on' })
    setServedDomainsForTests(['run.example'])
  })

  afterEach(async () => {
    resetServedDomainsForTests()
    await holder.db?.destroy()
  })

  it('refuses anyone who is not an admin', async () => {
    vi.mocked(getAdminFromSession).mockResolvedValue(null)
    const response = await patch('run.example', { name: 'Run Club' })
    expect(response.status).toBe(403)
  })

  it('saves trimmed identity and policy fields and returns the detail', async () => {
    const response = await patch('run.example', {
      name: '  Run Club ',
      description: 'Running together',
      contactEmail: ' hello@run.example ',
      termsOfService: '# Terms\n',
      privacyPolicy: '# Privacy'
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      domain: 'run.example',
      source: 'database',
      name: 'Run Club',
      description: 'Running together',
      contactEmail: 'hello@run.example',
      termsOfService: '# Terms',
      privacyPolicy: '# Privacy'
    })
    expect(typeof body.termsOfServiceUpdatedAt).toBe('number')
    expect(typeof body.privacyPolicyUpdatedAt).toBe('number')

    const read = await get('run.example')
    expect(read.status).toBe(200)
    await expect(read.json()).resolves.toMatchObject({
      name: 'Run Club',
      termsOfService: '# Terms'
    })
  })

  it('serves the saved identity to visitors of that domain at once', async () => {
    const database = holder.db as Database
    // Warm the identity cache with the old row.
    await expect(
      resolveDomainIdentity(database, 'run.example')
    ).resolves.toMatchObject({ name: 'Activities.next' })

    await patch('run.example', { name: 'Run Club', privacyPolicy: 'Ours' })

    await expect(
      resolveDomainIdentity(database, 'run.example')
    ).resolves.toMatchObject({
      name: 'Run Club',
      privacyPolicy: { markdown: 'Ours', source: 'domain' }
    })

    // Back to "Same as server".
    await patch('run.example', { name: null, privacyPolicy: null })
    await expect(
      resolveDomainIdentity(database, 'run.example')
    ).resolves.toMatchObject({ name: 'Activities.next', privacyPolicy: null })
  })

  it('clears a field with null', async () => {
    await patch('run.example', { description: 'Running together' })
    const response = await patch('run.example', { description: null })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      description: null
    })
  })

  it.each([
    { name: 'a blank name', body: { name: '   ' } },
    { name: 'a blank terms', body: { termsOfService: '' } },
    { name: 'a name that is too long', body: { name: 'x'.repeat(256) } },
    {
      name: 'a description that is too long',
      body: { description: 'x'.repeat(5001) }
    },
    { name: 'an invalid contact email', body: { contactEmail: 'not-email' } },
    {
      name: 'a privacy policy that is too long',
      body: { privacyPolicy: 'x'.repeat(100_001) }
    },
    {
      name: 'identity sent with status',
      body: { status: 'off', name: 'Run Club' }
    }
  ])('refuses $name with 422', async ({ body }) => {
    const response = await patch('run.example', body)
    expect(response.status).toBe(422)
  })

  it.each([
    {
      name: 'a malformed contact email',
      body: { contactEmail: 'hello@' },
      field: 'contactEmail',
      error: 'Enter a valid contact email address.'
    },
    {
      name: 'a name that is too long',
      body: { name: 'x'.repeat(ADMIN_DOMAIN_FIELD_LIMITS.name + 1) },
      field: 'name',
      error: `Name is too long (at most ${ADMIN_DOMAIN_FIELD_LIMITS.name} characters).`
    },
    {
      name: 'blank terms of service',
      body: { termsOfService: '   ' },
      field: 'termsOfService',
      error: 'Terms of service cannot be blank.'
    },
    {
      name: 'too many allowed emails',
      body: {
        allowedEmails: Array.from(
          { length: 1001 },
          (_, index) => `user${index}@run.example`
        )
      },
      field: 'allowedEmails',
      error: 'Allowed emails has too many addresses (at most 1000).'
    }
  ])(
    'names the field when it refuses $name',
    async ({ body, field, error }) => {
      const response = await patch('run.example', body)
      expect(response.status).toBe(422)
      await expect(response.json()).resolves.toEqual({
        error,
        code: 'invalid',
        field
      })
    }
  )

  it('sends the primary’s identity to Admin › Server settings', async () => {
    const response = await patch('social.example', { name: 'Social' })
    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      code: 'primary',
      error: PRIMARY_DOMAIN_IDENTITY_ERROR
    })
  })

  it('sends the primary’s sign-ups to Admin › Server settings', async () => {
    const response = await patch('social.example', { signupsOpen: false })
    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      code: 'primary',
      error: 'The primary domain’s sign-ups are set in Admin › Server settings.'
    })
  })

  it('gives an env domain a row on its first identity save', async () => {
    const response = await patch('club.example', { name: 'Club' })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      domain: 'club.example',
      source: 'env',
      status: 'on',
      name: 'Club'
    })
  })

  it('answers 404 for a domain it does not know', async () => {
    const response = await patch('nope.example', { name: 'Nope' })
    expect(response.status).toBe(404)
  })

  it('returns the primary’s detail with every override null', async () => {
    const response = await get('social.example')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      source: 'primary',
      description: null,
      contactEmail: null,
      termsOfService: null,
      privacyPolicy: null
    })
  })

  describe('disabled features', () => {
    it('collapses repeated values instead of answering 422', async () => {
      const response = await patch('run.example', {
        disabledFeatures: ['messages', 'messages', 'messages', 'messages']
      })
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({
        disabledFeatures: ['messages']
      })
      await patch('run.example', { disabledFeatures: [] })
    })

    it('reads as none and saves the list a domain turns off', async () => {
      await expect((await get('run.example')).json()).resolves.toMatchObject({
        disabledFeatures: []
      })

      const response = await patch('run.example', {
        disabledFeatures: ['messages', 'fitness', 'messages']
      })
      expect(response.status).toBe(200)
      // Deduplicated, in the registry's order.
      await expect(response.json()).resolves.toMatchObject({
        domain: 'run.example',
        disabledFeatures: ['fitness', 'messages']
      })
      await expect((await get('run.example')).json()).resolves.toMatchObject({
        disabledFeatures: ['fitness', 'messages']
      })
    })

    it('leaves the list alone when other fields are saved, and clears it with [] or null', async () => {
      await patch('run.example', { disabledFeatures: ['explore'] })
      await expect(
        (await patch('run.example', { name: 'Run Club' })).json()
      ).resolves.toMatchObject({ disabledFeatures: ['explore'] })

      await expect(
        (await patch('run.example', { disabledFeatures: [] })).json()
      ).resolves.toMatchObject({ disabledFeatures: [] })
      await patch('run.example', { disabledFeatures: ['explore'] })
      await expect(
        (await patch('run.example', { disabledFeatures: null })).json()
      ).resolves.toMatchObject({ disabledFeatures: [] })
    })

    it('applies to visitors of that domain at once, through the identity cache', async () => {
      const database = holder.db as Database
      await expect(
        resolveDomainIdentity(database, 'run.example')
      ).resolves.toMatchObject({ disabledFeatures: [] })

      await patch('run.example', { disabledFeatures: ['messages'] })

      await expect(
        resolveDomainIdentity(database, 'run.example')
      ).resolves.toMatchObject({ disabledFeatures: ['messages'] })
      // Another domain is not touched.
      await expect(
        resolveDomainIdentity(database, 'club.example')
      ).resolves.toMatchObject({ disabledFeatures: [] })
    })

    it('gives an env domain a row on its first save', async () => {
      const response = await patch('club.example', {
        disabledFeatures: ['fitness']
      })
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({
        domain: 'club.example',
        source: 'env',
        disabledFeatures: ['fitness']
      })
    })

    it('refuses the primary domain, which has no features of its own', async () => {
      const response = await patch('social.example', {
        disabledFeatures: ['fitness']
      })
      expect(response.status).toBe(422)
      await expect(response.json()).resolves.toEqual({
        code: 'primary',
        error: PRIMARY_DOMAIN_FEATURES_ERROR
      })
      await expect((await get('social.example')).json()).resolves.toMatchObject(
        { disabledFeatures: [] }
      )
    })

    it.each([
      { description: 'an unknown feature', value: ['fitness', 'gallery'] },
      { description: 'a string', value: 'fitness' }
    ])('refuses $description', async ({ value }) => {
      const response = await patch('run.example', { disabledFeatures: value })
      expect(response.status).toBe(422)
      await expect(response.json()).resolves.toMatchObject({
        code: 'invalid',
        field: 'disabledFeatures'
      })
    })

    it('is not mixed into a status change', async () => {
      const response = await patch('run.example', {
        status: 'off',
        disabledFeatures: ['fitness']
      })
      expect(response.status).toBe(422)
    })
  })

  // A rename keeps the actor id, so an actor renamed away from the domain
  // still blocks it, and one renamed onto it blocks it too.
  describe('has-profiles refusal with a renamed actor', () => {
    const createActorOnDomain = async (username: string, domain: string) => {
      const accountId = await holder.db!.createAccount({
        email: `${username}-${crypto.randomUUID()}@mail.example`,
        username,
        passwordHash: 'hash',
        domain,
        privateKey: `private-${username}`,
        publicKey: `public-${username}`
      })
      const actors = await holder.db!.getActorsForAccount({ accountId })
      return actors[0].id
    }

    it('answers 409 with the blocking actors for a status change', async () => {
      const actorId = await createActorOnDomain('mover', 'run.example')
      await holder.db!.recordActorHandleRename({
        actorId,
        username: 'moved',
        domain: 'new.example',
        now: new Date('2026-01-01T00:00:00.000Z'),
        cooldownMs: 30 * 24 * 60 * 60 * 1000
      })

      const response = await patch('run.example', { status: 'off' })
      expect(response.status).toBe(409)
      await expect(response.json()).resolves.toEqual({
        error: 'Profiles still use this domain, so it cannot be turned off.',
        code: 'has-profiles',
        actors: [{ id: actorId, acct: 'moved@new.example' }]
      })
      // The domain row is untouched.
      expect(
        (await holder.db!.getServedDomain({ domain: 'run.example' }))?.status
      ).toBe('on')
    })

    it('answers 409 with the blocking actors for a removal', async () => {
      // Off first: the actor created below would refuse the turn-off itself.
      await patch('run.example', { status: 'off' })
      const actorId = await createActorOnDomain('stayer', 'run.example')

      const response = await del('run.example')
      expect(response.status).toBe(409)
      await expect(response.json()).resolves.toEqual({
        error: 'Profiles still use this domain, so it can only be turned off.',
        code: 'has-profiles',
        actors: [{ id: actorId, acct: 'stayer@run.example' }]
      })
      await expect(
        holder.db!.getServedDomain({ domain: 'run.example' })
      ).resolves.toMatchObject({ domain: 'run.example' })
    })

    it('turns a domain with no local actors off', async () => {
      const response = await patch('run.example', { status: 'off' })
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({ status: 'off' })
    })
  })
})
