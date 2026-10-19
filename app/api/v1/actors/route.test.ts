import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { deleteServerSetting } from '@/lib/database/testing/fixtures'
import { FEDERATION_SIGNING_ACTOR_USERNAME } from '@/lib/services/federation/instanceActor'
import { invalidateServerSettingsCache } from '@/lib/services/serverSettings'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'

import { POST } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', async () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

const mockGetConfig = vi.fn()
vi.mock('@/lib/config', async () => ({
  getConfig: () => mockGetConfig(),
  getBaseURL: () => 'https://llun.test'
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', async () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', async () => ({
  cookies: vi.fn().mockResolvedValue({
    get: () => undefined
  })
}))

vi.mock('crypto', async () => {
  const actual = await vi.importActual<typeof import('crypto')>('crypto')
  const { promisify } = await vi.importActual<typeof import('util')>('util')
  const mockGenerateKeyPair = Object.assign(vi.fn(), {
    [promisify.custom]: () =>
      Promise.resolve({ publicKey: 'public-key', privateKey: 'private-key' })
  })
  return {
    ...actual,
    generateKeyPair: mockGenerateKeyPair
  }
})

describe('POST /api/v1/actors', () => {
  const { database, db } = createTestDatabase({ backend: 'sqlite' })

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    mockGetServerSession.mockReset()
    mockGetConfig.mockReset()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  const createRequest = (body: Record<string, string>) =>
    new NextRequest('https://llun.test/api/v1/actors', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://llun.test'
      },
      body: JSON.stringify(body)
    })

  it('uses the requested domain when it is allowed', async () => {
    mockGetConfig.mockReturnValue({ host: 'llun.test', allowEmails: [] })
    // allowActorDomains is a database-backed federation setting.
    await database.setServerSettings([
      {
        key: 'federation.allowActorDomains',
        value: ['allowed.test', 'llun.test']
      }
    ])
    invalidateServerSettingsCache(database)

    try {
      const response = await POST(
        createRequest({ username: 'newactor-allowed', domain: 'allowed.test' }),
        { params: Promise.resolve({}) }
      )

      const data = await response.json()
      expect(response.status).toBe(200)
      expect(data.domain).toBe('allowed.test')
    } finally {
      await deleteServerSetting(db, {
        key: 'federation.allowActorDomains'
      })
      invalidateServerSettingsCache(database)
    }
  })

  it('allows creating an actor on a trusted host when allowActorDomains is not set', async () => {
    mockGetConfig.mockReturnValue({
      host: 'llun.test',
      trustedHosts: ['alias.llun.test'],
      allowEmails: []
    })

    const response = await POST(
      createRequest({
        username: 'newactor-trusted',
        domain: 'alias.llun.test'
      }),
      { params: Promise.resolve({}) }
    )

    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.domain).toBe('alias.llun.test')
  })

  it('falls back to the current actor domain when none is provided', async () => {
    mockGetConfig.mockReturnValue({
      host: 'llun.test',
      allowEmails: [],
      allowActorDomains: ['llun.test']
    })

    const response = await POST(
      createRequest({ username: 'newactor-default' }),
      { params: Promise.resolve({}) }
    )

    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.domain).toBe('llun.test')
  })

  it('returns 400 when the request body is malformed JSON', async () => {
    mockGetConfig.mockReturnValue({
      host: 'llun.test',
      allowEmails: [],
      allowActorDomains: ['llun.test']
    })

    const response = await POST(
      new NextRequest('https://llun.test/api/v1/actors', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://llun.test'
        },
        body: 'not-json{'
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(400)
  })

  it('rejects domains that are not on the allow list', async () => {
    mockGetConfig.mockReturnValue({
      host: 'llun.test',
      allowEmails: [],
      allowActorDomains: ['allowed.test']
    })

    const response = await POST(
      createRequest({ username: 'newactor-denied', domain: 'bad.test' }),
      { params: Promise.resolve({}) }
    )

    const data = await response.json()
    expect(response.status).toBe(400)
    expect(data.error).toBe('Domain is not allowed')
  })

  // The allow-list is matched with the served-domain rules rather than a raw
  // `includes`: case and a trailing dot cannot make an allowed domain look
  // foreign. A wildcard rule approves nothing, neither its subdomains nor the
  // rule itself, and anything that is not a bare domain is never a domain to
  // create on.
  it.each([
    {
      description: 'an allowed domain in another case',
      username: 'newactor-case',
      domain: 'ALLOWED.test.',
      status: 200,
      storedDomain: 'allowed.test'
    },
    {
      description: 'a subdomain of a wildcard rule',
      username: 'newactor-wildcard',
      domain: 'alice.people.test',
      status: 400
    },
    {
      description: 'social.example.org beside an *.example.org wildcard',
      username: 'newactor-wildcard-remote',
      domain: 'social.example.org',
      status: 400
    },
    {
      description: 'the wildcard rule itself',
      username: 'newactor-literal-wildcard',
      domain: '*.people.test',
      status: 400
    },
    {
      description: 'the parent of a wildcard rule',
      username: 'newactor-wildcard-parent',
      domain: 'people.test',
      status: 400
    },
    {
      description: 'an allowed domain with a path',
      username: 'newactor-path',
      domain: 'allowed.test/users',
      status: 400
    },
    {
      description: 'a domain on no rule',
      username: 'newactor-untrusted',
      domain: 'evil.test',
      status: 400
    }
  ])(
    'answers $status for $description',
    async ({ username, domain, status, storedDomain }) => {
      mockGetConfig.mockReturnValue({ host: 'llun.test', allowEmails: [] })
      await database.setServerSettings([
        {
          key: 'federation.allowActorDomains',
          value: ['Allowed.Test', '*.people.test', '*.example.org']
        }
      ])
      invalidateServerSettingsCache(database)

      try {
        const response = await POST(createRequest({ username, domain }), {
          params: Promise.resolve({})
        })

        const data = await response.json()
        expect(response.status).toBe(status)
        if (storedDomain) {
          expect(data.domain).toBe(storedDomain)
          await expect(
            database.isUsernameExists({ username, domain: storedDomain })
          ).resolves.toBeTrue()
        } else {
          expect(data.error).toBe('Domain is not allowed')
        }
      } finally {
        await deleteServerSetting(db, {
          key: 'federation.allowActorDomains'
        })
        invalidateServerSettingsCache(database)
      }
    }
  )

  // A wildcard trusted host exists to believe X-Forwarded-Host (preview
  // deployments, say), so without allowActorDomains it approves no actor
  // domain: only the primary host and concrete trusted hosts do.
  it.each([
    { domain: 'bob.alias.llun.test', status: 400 },
    { domain: 'other.llun.test', status: 200 }
  ])(
    'answers $status for $domain beside a wildcard trusted host when allowActorDomains is not set',
    async ({ domain, status }) => {
      mockGetConfig.mockReturnValue({
        host: 'llun.test',
        trustedHosts: ['*.alias.llun.test', 'other.llun.test'],
        allowEmails: []
      })

      const response = await POST(
        createRequest({
          username: `newactor-fallback-${status}`,
          domain
        }),
        { params: Promise.resolve({}) }
      )

      const data = await response.json()
      expect(response.status).toBe(status)
      if (status === 200) {
        expect(data.domain).toBe(domain)
      } else {
        expect(data.error).toBe('Domain is not allowed')
      }
    }
  )

  // Domains are stored normalised now, but an actor written earlier may carry
  // the raw spelling the request used; that name is still taken.
  it('rejects a username that exists under the raw requested domain spelling', async () => {
    mockGetConfig.mockReturnValue({
      host: 'llun.test',
      trustedHosts: ['legacy.llun.test'],
      allowEmails: []
    })
    const account = await database.getAccountFromEmail({
      email: seedActor1.email
    })
    if (!account) throw new Error('seed account is missing')
    await database.createActorForAccount({
      accountId: account.id,
      username: 'rawspelled',
      domain: 'legacy.llun.test:443',
      publicKey: 'public-key',
      privateKey: 'private-key'
    })

    const response = await POST(
      createRequest({ username: 'rawspelled', domain: 'legacy.llun.test:443' }),
      { params: Promise.resolve({}) }
    )

    const data = await response.json()
    expect(response.status).toBe(400)
    expect(data.error).toBe('Username already exists')
    await expect(
      database.isUsernameExists({
        username: 'rawspelled',
        domain: 'legacy.llun.test'
      })
    ).resolves.toBeFalse()
  })

  it('rejects the reserved federation signing actor username', async () => {
    mockGetConfig.mockReturnValue({
      host: 'llun.test',
      allowEmails: [],
      allowActorDomains: ['llun.test']
    })

    const response = await POST(
      createRequest({ username: FEDERATION_SIGNING_ACTOR_USERNAME }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(400)
  })

  it('rejects usernames in the federation signing actor namespace', async () => {
    mockGetConfig.mockReturnValue({
      host: 'llun.test',
      allowEmails: [],
      allowActorDomains: ['llun.test']
    })

    const response = await POST(
      createRequest({ username: `${FEDERATION_SIGNING_ACTOR_USERNAME}abc` }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(400)
  })

  // This route used to check only length, so it was the looser of the two ways
  // to mint a local actor. A username is an unencoded path segment of the
  // actor's canonical id and a path segment is percent-DECODED on the way back
  // in, so `%6eull` would resolve to whoever owns `null`.
  it.each([['%6eull'], ['%6Eull'], ['nul%6c'], ['a%2Fb'], ['a/b']])(
    'rejects the username %j, which would decode to another actor id',
    async (username) => {
      mockGetConfig.mockReturnValue({
        host: 'llun.test',
        allowEmails: [],
        allowActorDomains: ['llun.test']
      })

      const response = await POST(createRequest({ username }), {
        params: Promise.resolve({})
      })

      expect(response.status).toBe(400)
    }
  )

  // With allowActorDomains empty an added domain approves an actor only while
  // it is on and "Existing users can add profiles here" is on.
  it.each([
    { domain: 'run.test', status: 'on', allowExistingUsers: true, ok: true },
    {
      domain: 'birds.test',
      status: 'on',
      allowExistingUsers: false,
      ok: false
    },
    { domain: 'old.test', status: 'off', allowExistingUsers: true, ok: false }
  ] as const)(
    'answers $ok for an added domain that is $status with existing users $allowExistingUsers',
    async ({ domain, status, allowExistingUsers, ok }) => {
      mockGetConfig.mockReturnValue({ host: 'llun.test', allowEmails: [] })
      await database.createServedDomain({ domain, status, allowExistingUsers })
      try {
        const response = await POST(
          createRequest({ username: `added-${domain.split('.')[0]}`, domain }),
          { params: Promise.resolve({}) }
        )
        const data = await response.json()
        expect(response.status).toBe(ok ? 200 : 400)
        if (ok) expect(data.domain).toBe(domain)
        else expect(data.error).toBe('Domain is not allowed')
      } finally {
        await database.deleteServedDomain({ domain })
      }
    }
  )

  // An account admitted through another domain's own sign-up rules does not
  // thereby pass the primary's (or another env domain's): a profile there
  // needs that domain's admission, or a profile there already.
  describe('for an account that signed up on another env domain', () => {
    const outsiderEmail = 'outsider@mail.test'
    let outsiderId: string

    beforeAll(async () => {
      outsiderId = await database.createAccount({
        email: outsiderEmail,
        username: 'outsider',
        domain: 'run.test',
        passwordHash: 'hash',
        privateKey: 'private',
        publicKey: 'public'
      })
    })

    const setPrimary = async (open: boolean, allowEmails: string[]) => {
      await database.setServerSettings([
        { key: 'registrations.open', value: open },
        { key: 'registrations.allowEmails', value: allowEmails }
      ])
      invalidateServerSettingsCache(database)
    }

    beforeEach(async () => {
      mockGetConfig.mockReturnValue({
        host: 'llun.test',
        trustedHosts: ['run.test'],
        allowEmails: []
      })
      mockGetServerSession.mockResolvedValue({ user: { email: outsiderEmail } })
      await database.createServedDomain({
        domain: 'run.test',
        status: 'off',
        signupsOpen: true
      })
      await setPrimary(false, [seedActor1.email])
    })

    afterEach(async () => {
      await database.deleteServedDomain({ domain: 'run.test' })
      await deleteServerSetting(db, { key: 'registrations.open' })
      await deleteServerSetting(db, { key: 'registrations.allowEmails' })
      invalidateServerSettingsCache(database)
    })

    it('refuses a profile on a primary that would not admit the account', async () => {
      const response = await POST(
        createRequest({ username: 'outsider-primary', domain: 'llun.test' }),
        { params: Promise.resolve({}) }
      )
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'Domain is not allowed' })
    })

    it('allows a profile on a primary open to the address', async () => {
      await setPrimary(true, [])
      const response = await POST(
        createRequest({ username: 'outsider-open', domain: 'llun.test' }),
        { params: Promise.resolve({}) }
      )
      expect(response.status).toBe(200)
      expect((await response.json()).domain).toBe('llun.test')
    })

    it('allows another profile on a domain the account already has one on', async () => {
      await database.createActorForAccount({
        accountId: outsiderId,
        username: 'outsider-existing',
        domain: 'llun.test',
        publicKey: 'public',
        privateKey: 'private'
      })
      const response = await POST(
        createRequest({ username: 'outsider-second', domain: 'llun.test' }),
        { params: Promise.resolve({}) }
      )
      expect(response.status).toBe(200)
    })

    it('leaves an account that signed up on the primary as before', async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: seedActor1.email }
      })
      // club.test has no row, so its sign-ups are closed.
      mockGetConfig.mockReturnValue({
        host: 'llun.test',
        trustedHosts: ['run.test', 'club.test'],
        allowEmails: []
      })
      const response = await POST(
        createRequest({ username: 'primary-on-club', domain: 'club.test' }),
        { params: Promise.resolve({}) }
      )
      expect(response.status).toBe(200)
      expect((await response.json()).domain).toBe('club.test')
    })
  })
})
