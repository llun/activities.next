import { resolveTxt } from 'node:dns/promises'

import { getConfig } from '@/lib/config'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  BlueskyLinkError,
  checkBlueskyHandle,
  completeBlueskyOAuth,
  getBlueskyAccountState,
  linkBlueskyAppPassword,
  setBlueskyInstanceHandle,
  startBlueskyOAuth,
  unlinkBluesky,
  updateBlueskyCrosspostDefault
} from '@/lib/services/bluesky/account'
import {
  getBlueskyOAuthClient,
  writeStoredBlueskySession
} from '@/lib/services/bluesky/client'
import { createBlueskyIdentityResolver } from '@/lib/services/bluesky/identityResolver'
import { getQueue } from '@/lib/services/queue'
import type { Actor } from '@/lib/types/domain/actor'
import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'

vi.mock('node:dns/promises', () => ({ resolveTxt: vi.fn() }))
vi.mock('@/lib/config', () => ({ getConfig: vi.fn() }))
vi.mock('@/lib/utils/safeRemoteFetch', () => ({ safeRemoteFetch: vi.fn() }))
vi.mock('@/lib/services/queue', () => ({ getQueue: vi.fn() }))
vi.mock('@/lib/services/bluesky/client', () => ({
  BLUESKY_OAUTH_SCOPE: 'atproto transition:generic',
  getBlueskyOAuthClient: vi.fn(),
  writeStoredBlueskySession: vi.fn()
}))
vi.mock('@/lib/services/bluesky/identityResolver', () => ({
  createBlueskyIdentityResolver: vi.fn()
}))

const DID = 'did:plc:abc123'
const PDS = 'https://pds.example.net/'

const actor = (id: string, role?: 'admin', domain = 'social.example') =>
  ({ id, domain, account: { id: `${id}-account`, role } }) as unknown as Actor

// A PDS access token carrying `scope`; only the payload is read.
const jwt = (scope: string) =>
  `e30.${Buffer.from(JSON.stringify({ scope })).toString('base64url')}.sig`
const APP_PASSWORD_JWT = jwt('com.atproto.appPass')

const respond = (statusCode: number, body: unknown) => ({
  statusCode,
  body: JSON.stringify(body),
  bodyTruncated: false,
  headers: {},
  url: ''
})

describe('Bluesky account service', () => {
  const testDb = createTestDatabase()
  const { database } = testDb
  const resolve = vi.fn()
  const publish = vi.fn()

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
    // actor-a and actor-b are admins' actors: a domain claim needs one.
    for (const id of ['a', 'b']) {
      await testDb.db
        .insertInto('accounts')
        .values({ id: `account-${id}`, role: 'admin' })
        .execute()
      await testDb.db
        .insertInto('actors')
        .values({
          id: `actor-${id}`,
          accountId: `account-${id}`,
          username: id,
          domain: id === 'a' ? 'social.example' : 'other.example'
        })
        .execute()
    }
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    publish.mockResolvedValue(undefined)
    vi.mocked(getQueue).mockReturnValue({ publish } as never)
    vi.mocked(getConfig).mockReturnValue({
      host: 'social.example',
      bluesky: { oauthPrivateKeys: [] }
    } as never)
    vi.mocked(createBlueskyIdentityResolver).mockReturnValue({
      resolve
    } as never)
    resolve.mockResolvedValue({
      did: DID,
      handle: 'alice.example.com',
      didDoc: {
        id: DID,
        service: [
          {
            id: '#atproto_pds',
            type: 'AtprotoPersonalDataServer',
            serviceEndpoint: PDS
          }
        ]
      }
    })
    vi.mocked(safeRemoteFetch).mockImplementation(async ({ url }) =>
      url.endsWith('describeServer')
        ? respond(200, { availableUserDomains: ['.pds.example.net'] })
        : respond(200, {
            did: DID,
            handle: 'alice.example.com',
            accessJwt: APP_PASSWORD_JWT,
            refreshJwt: 'refresh'
          })
    )
  })

  afterEach(async () => {
    vi.clearAllMocks()
    for (const id of ['actor-a', 'actor-b']) {
      await database.deleteBlueskyAccount({ actorId: id })
    }
    // Each test starts with a fresh per-actor window.
    await database.deleteRateLimits({ keyPrefix: 'app:bluesky:' })
    // Sessions a test stored without a link.
    for (const did of [DID, 'did:plc:other']) {
      await database.deleteBlueskySession({ did })
    }
  })

  describe('linkBlueskyAppPassword', () => {
    it('refuses a new link when federation policy disallows Bluesky', async () => {
      const block = await database.createDomainBlock({
        domain: 'bsky.app',
        severity: 'suspend'
      })
      try {
        await expect(
          linkBlueskyAppPassword(database, actor('actor-a'), {
            identifier: 'alice.example.com',
            password: 'abcd-efgh-ijkl-mnop'
          })
        ).rejects.toMatchObject({
          status: 422,
          message: 'This server does not allow Bluesky.'
        })
        expect(resolve).not.toHaveBeenCalled()
        expect(safeRemoteFetch).not.toHaveBeenCalled()
        expect(
          await database.getBlueskyAccount({ actorId: 'actor-a' })
        ).toBeNull()
      } finally {
        await database.deleteDomainBlock(block.id)
      }
    })

    it('refuses anything but the app-password shape before any request', async () => {
      await expect(
        linkBlueskyAppPassword(database, actor('actor-a'), {
          identifier: 'alice.example.com',
          password: 'my main password'
        })
      ).rejects.toThrow('app password')
      expect(resolve).not.toHaveBeenCalled()
      expect(safeRemoteFetch).not.toHaveBeenCalled()
    })

    it('refuses a URL instead of a handle', async () => {
      await expect(
        linkBlueskyAppPassword(database, actor('actor-a'), {
          identifier: 'https://10.0.0.1/xrpc',
          password: 'abcd-efgh-ijkl-mnop'
        })
      ).rejects.toBeInstanceOf(BlueskyLinkError)
      expect(resolve).not.toHaveBeenCalled()
    })

    it('signs in on the account’s own PDS and stores the link and session', async () => {
      await linkBlueskyAppPassword(database, actor('actor-a'), {
        identifier: '@Alice.Example.com',
        password: 'abcd-efgh-ijkl-mnop'
      })

      expect(resolve).toHaveBeenCalledWith('alice.example.com', {
        noCache: false
      })
      expect(safeRemoteFetch).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://pds.example.net/xrpc/com.atproto.server.createSession',
          method: 'POST',
          maxRedirects: 0,
          body: JSON.stringify({
            identifier: DID,
            password: 'abcd-efgh-ijkl-mnop'
          })
        })
      )
      expect(
        await database.getBlueskyAccount({ actorId: 'actor-a' })
      ).toMatchObject({
        did: DID,
        handle: 'alice.example.com',
        pdsUrl: PDS,
        authType: 'app_password',
        domainHandle: true
      })
      expect(writeStoredBlueskySession).toHaveBeenCalledWith(database, DID, {
        type: 'app_password',
        accessJwt: APP_PASSWORD_JWT,
        refreshJwt: 'refresh'
      })
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'SyncBlueskyHomeJob',
          data: { actorId: 'actor-a' }
        })
      )
    })

    it('keeps the link when the first Home sync cannot be queued', async () => {
      publish.mockRejectedValue(new Error('queue down'))
      await linkBlueskyAppPassword(database, actor('actor-a'), {
        identifier: 'alice.example.com',
        password: 'abcd-efgh-ijkl-mnop'
      })
      expect(
        await database.getBlueskyAccount({ actorId: 'actor-a' })
      ).toMatchObject({ did: DID })
    })

    it('marks a handle under the PDS’s own domain as not a domain handle', async () => {
      resolve.mockResolvedValueOnce({
        ...(await resolve()),
        handle: 'alice.pds.example.net'
      })
      await linkBlueskyAppPassword(database, actor('actor-a'), {
        identifier: 'alice.pds.example.net',
        password: 'abcd-efgh-ijkl-mnop'
      })
      expect(
        (await database.getBlueskyAccount({ actorId: 'actor-a' }))?.domainHandle
      ).toBe(false)
    })

    it('refuses a main password that happens to look like an app password', async () => {
      vi.mocked(safeRemoteFetch).mockImplementation(async ({ url }) =>
        url.endsWith('describeServer')
          ? respond(200, { availableUserDomains: [] })
          : respond(200, {
              did: DID,
              accessJwt: jwt('com.atproto.access'),
              refreshJwt: 'refresh'
            })
      )
      await expect(
        linkBlueskyAppPassword(database, actor('actor-a'), {
          identifier: 'alice.example.com',
          password: 'abcd-efgh-ijkl-mnop'
        })
      ).rejects.toThrow('app password')
      expect(
        await database.getBlueskyAccount({ actorId: 'actor-a' })
      ).toBeNull()
      expect(writeStoredBlueskySession).not.toHaveBeenCalled()
    })

    it('says the password is wrong on a 401', async () => {
      vi.mocked(safeRemoteFetch).mockResolvedValue(
        respond(401, { error: 'AuthenticationRequired' })
      )
      await expect(
        linkBlueskyAppPassword(database, actor('actor-a'), {
          identifier: 'alice.example.com',
          password: 'abcd-efgh-ijkl-mnop'
        })
      ).rejects.toThrow('wrong')
      expect(
        await database.getBlueskyAccount({ actorId: 'actor-a' })
      ).toBeNull()
    })

    it('refuses a session for another DID than the handle resolved to', async () => {
      vi.mocked(safeRemoteFetch).mockResolvedValue(
        respond(200, {
          did: 'did:plc:someoneelse',
          accessJwt: 'a',
          refreshJwt: 'r'
        })
      )
      await expect(
        linkBlueskyAppPassword(database, actor('actor-a'), {
          identifier: 'alice.example.com',
          password: 'abcd-efgh-ijkl-mnop'
        })
      ).rejects.toThrow('unexpected')
      expect(
        await database.getBlueskyAccount({ actorId: 'actor-a' })
      ).toBeNull()
      expect(writeStoredBlueskySession).not.toHaveBeenCalled()
    })

    it('refuses a DID another actor already linked', async () => {
      const input = {
        identifier: 'alice.example.com',
        password: 'abcd-efgh-ijkl-mnop'
      }
      await linkBlueskyAppPassword(database, actor('actor-a'), input)
      await expect(
        linkBlueskyAppPassword(database, actor('actor-b'), input)
      ).rejects.toMatchObject({ status: 409 })
      expect(writeStoredBlueskySession).toHaveBeenCalledTimes(1)
    })
  })

  describe('OAuth', () => {
    it('refuses starting or finishing sign-in when federation policy disallows Bluesky', async () => {
      const authorize = vi.fn()
      const callback = vi.fn()
      vi.mocked(getBlueskyOAuthClient).mockReturnValue(
        Promise.resolve({ authorize, callback }) as never
      )
      const block = await database.createDomainBlock({
        domain: 'bsky.app',
        severity: 'suspend'
      })
      try {
        await expect(
          startBlueskyOAuth(database, actor('actor-a'), 'alice.example.com')
        ).rejects.toMatchObject({
          status: 422,
          message: 'This server does not allow Bluesky.'
        })
        expect(resolve).not.toHaveBeenCalled()
        expect(authorize).not.toHaveBeenCalled()

        expect(
          await completeBlueskyOAuth(
            database,
            actor('actor-a'),
            new URLSearchParams('code=c&state=s')
          )
        ).toBe('failed')
        expect(callback).not.toHaveBeenCalled()
        expect(
          await database.getBlueskyAccount({ actorId: 'actor-a' })
        ).toBeNull()
      } finally {
        await database.deleteDomainBlock(block.id)
      }
    })

    it('starts sign-in with the actor as state', async () => {
      const authorize = vi
        .fn()
        .mockResolvedValue(new URL('https://auth.example.net/authorize?x=1'))
      vi.mocked(getBlueskyOAuthClient).mockReturnValue(
        Promise.resolve({ authorize }) as never
      )
      expect(
        await startBlueskyOAuth(database, actor('actor-a'), 'alice.example.com')
      ).toBe('https://auth.example.net/authorize?x=1')
      // Resolved first, so the sign-in is bound to that DID.
      expect(authorize).toHaveBeenCalledWith(DID, {
        scope: 'atproto transition:generic',
        state: 'actor-a'
      })
    })

    it('refuses a DID another actor holds before the authorization server sees it', async () => {
      await database.saveBlueskyAccount({
        actorId: 'actor-b',
        did: DID,
        handle: 'alice.example.com',
        pdsUrl: PDS,
        authType: 'app_password',
        domainHandle: true
      })
      const authorize = vi.fn()
      vi.mocked(getBlueskyOAuthClient).mockReturnValue(
        Promise.resolve({ authorize }) as never
      )
      await expect(
        startBlueskyOAuth(database, actor('actor-a'), 'alice.example.com')
      ).rejects.toMatchObject({ status: 409 })
      expect(authorize).not.toHaveBeenCalled()
    })

    it('starts sign-in from the actor’s own domain', async () => {
      const authorize = vi
        .fn()
        .mockResolvedValue(new URL('https://auth.example.net/authorize'))
      vi.mocked(getBlueskyOAuthClient).mockReturnValue(
        Promise.resolve({ authorize }) as never
      )
      await startBlueskyOAuth(
        database,
        actor('actor-a', undefined, 'Social.Example'),
        'alice.example.com',
        'social.example'
      )
      expect(authorize).toHaveBeenCalled()
    })

    it('uses the canonical domain’s client to start and to finish sign-in', async () => {
      const legacy = actor('actor-a', undefined, 'Social.Example:443')
      vi.mocked(getBlueskyOAuthClient).mockReturnValue(
        Promise.resolve({
          authorize: vi
            .fn()
            .mockResolvedValue(new URL('https://auth.example.net/authorize')),
          callback: vi.fn().mockRejectedValue(new Error('denied'))
        }) as never
      )
      await startBlueskyOAuth(
        database,
        legacy,
        'alice.example.com',
        'social.example'
      )
      await completeBlueskyOAuth(
        database,
        legacy,
        new URLSearchParams('error=access_denied')
      )
      expect(vi.mocked(getBlueskyOAuthClient).mock.calls).toEqual([
        [database, 'social.example'],
        [database, 'social.example']
      ])
    })

    it('starts sign-in only on the domain the actor lives on', async () => {
      const authorize = vi.fn()
      vi.mocked(getBlueskyOAuthClient).mockReturnValue(
        Promise.resolve({ authorize }) as never
      )
      await expect(
        startBlueskyOAuth(
          database,
          actor('actor-a'),
          'alice.example.com',
          'primary.example'
        )
      ).rejects.toThrow('Open Settings on social.example')
      expect(authorize).not.toHaveBeenCalled()
    })

    it('reports a key that will not load as a server error', async () => {
      const keyError = new Error('Invalid key')
      const rejected = Promise.reject(keyError)
      rejected.catch(() => undefined)
      vi.mocked(getBlueskyOAuthClient).mockReturnValue(rejected as never)
      await expect(
        startBlueskyOAuth(database, actor('actor-a'), 'alice.example.com')
      ).rejects.toBe(keyError)
    })

    it('offers app passwords when the account’s servers refuse sign-in', async () => {
      vi.mocked(getBlueskyOAuthClient).mockReturnValue(
        Promise.resolve({
          authorize: vi.fn().mockRejectedValue(new Error('invalid_client'))
        }) as never
      )
      await expect(
        startBlueskyOAuth(database, actor('actor-a'), 'alice.example.com')
      ).rejects.toMatchObject({
        status: 502,
        message: expect.stringContaining('app password')
      })
    })

    it('never sends the browser to a sign-in page that is not HTTPS', async () => {
      vi.mocked(getBlueskyOAuthClient).mockReturnValue(
        Promise.resolve({
          authorize: vi
            .fn()
            .mockResolvedValue(new URL('http://127.0.0.1:8080/authorize'))
        }) as never
      )
      await expect(
        startBlueskyOAuth(database, actor('actor-a'), 'alice.example.com')
      ).rejects.toThrow('not secure')
    })

    it('uses the OAuth client of the domain the actor lives on', async () => {
      vi.mocked(getBlueskyOAuthClient).mockReturnValue(null)
      await startBlueskyOAuth(
        database,
        actor('actor-a', undefined, 'other.example'),
        'alice.example.com'
      ).catch(() => undefined)
      expect(getBlueskyOAuthClient).toHaveBeenCalledWith(
        database,
        'other.example'
      )
    })

    it('says so when the server has no OAuth keys', async () => {
      vi.mocked(getBlueskyOAuthClient).mockReturnValue(null)
      await expect(
        startBlueskyOAuth(database, actor('actor-a'), 'alice.example.com')
      ).rejects.toThrow('not set up')
    })

    it('links the account in the callback', async () => {
      vi.mocked(getBlueskyOAuthClient).mockReturnValue(
        Promise.resolve({
          callback: vi
            .fn()
            .mockResolvedValue({ session: { did: DID }, state: 'actor-a' })
        }) as never
      )
      expect(
        await completeBlueskyOAuth(
          database,
          actor('actor-a'),
          new URLSearchParams('code=c&state=s')
        )
      ).toBe('linked')
      expect(resolve).toHaveBeenCalledWith(DID, { noCache: true })
      expect(
        await database.getBlueskyAccount({ actorId: 'actor-a' })
      ).toMatchObject({ did: DID, authType: 'oauth' })
      // The client of the domain the sign-in started on (the session is tied
      // to its client_id).
      expect(getBlueskyOAuthClient).toHaveBeenCalledWith(
        database,
        'social.example'
      )
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'SyncBlueskyHomeJob',
          data: { actorId: 'actor-a' }
        })
      )
    })

    it('drops the session when the link loses a race for the DID', async () => {
      await database.saveBlueskyAccount({
        actorId: 'actor-b',
        did: 'did:plc:other',
        handle: 'bob.example.com',
        pdsUrl: PDS,
        authType: 'oauth',
        domainHandle: true
      })
      // actor-a re-links its own DID in another tab: did_taken from the
      // primary key race is simulated by holding the DID it resolves to.
      resolve.mockResolvedValueOnce({
        ...(await resolve()),
        did: 'did:plc:other'
      })
      vi.mocked(getBlueskyOAuthClient).mockReturnValue(
        Promise.resolve({
          callback: vi.fn().mockResolvedValue({
            session: { did: 'did:plc:unlinked' },
            state: 'actor-a'
          })
        }) as never
      )
      await database.setBlueskySession({
        did: 'did:plc:unlinked',
        session: 'stored'
      })
      expect(
        await completeBlueskyOAuth(
          database,
          actor('actor-a'),
          new URLSearchParams('code=c&state=s')
        )
      ).toBe('did_taken')
      expect(
        await database.getBlueskySession({ did: 'did:plc:unlinked' })
      ).toBeNull()
      expect(publish).not.toHaveBeenCalled()
    })

    it('refuses a callback started by another actor and drops its session', async () => {
      await database.setBlueskySession({ did: DID, session: 'stored' })
      vi.mocked(getBlueskyOAuthClient).mockReturnValue(
        Promise.resolve({
          callback: vi
            .fn()
            .mockResolvedValue({ session: { did: DID }, state: 'actor-b' })
        }) as never
      )
      expect(
        await completeBlueskyOAuth(
          database,
          actor('actor-a'),
          new URLSearchParams('code=c&state=s')
        )
      ).toBe('failed')
      expect(
        await database.getBlueskyAccount({ actorId: 'actor-a' })
      ).toBeNull()
      expect(await database.getBlueskySession({ did: DID })).toBeNull()
    })

    it('drops the stored session when the link cannot be saved', async () => {
      await database.setBlueskySession({ did: DID, session: 'stored' })
      vi.mocked(getBlueskyOAuthClient).mockReturnValue(
        Promise.resolve({
          callback: vi
            .fn()
            .mockResolvedValue({ session: { did: DID }, state: 'actor-a' })
        }) as never
      )
      resolve.mockRejectedValueOnce(new Error('plc.directory timed out'))
      expect(
        await completeBlueskyOAuth(
          database,
          actor('actor-a'),
          new URLSearchParams('code=c&state=s')
        )
      ).toBe('failed')
      expect(await database.getBlueskySession({ did: DID })).toBeNull()
    })

    it('reports a failed exchange', async () => {
      vi.mocked(getBlueskyOAuthClient).mockReturnValue(
        Promise.resolve({
          callback: vi.fn().mockRejectedValue(new Error('invalid_grant'))
        }) as never
      )
      expect(
        await completeBlueskyOAuth(
          database,
          actor('actor-a'),
          new URLSearchParams('error=access_denied')
        )
      ).toBe('failed')
    })
  })

  describe('state, handle check and server handle', () => {
    const linkAlice = (id = 'actor-a') =>
      database.saveBlueskyAccount({
        actorId: id,
        did: DID,
        handle: 'alice.example.com',
        pdsUrl: PDS,
        authType: 'oauth',
        domainHandle: true
      })

    it('reports the link, whether its session is still there, and OAuth availability', async () => {
      vi.mocked(getConfig).mockReturnValue({ host: 'social.example' } as never)
      expect(await getBlueskyAccountState(database, actor('actor-a'))).toEqual({
        oauthAvailable: false,
        account: null,
        instanceHandle: null
      })

      await linkAlice()
      expect(
        (await getBlueskyAccountState(database, actor('actor-a'))).account
      ).toMatchObject({
        did: DID,
        sessionActive: false,
        lastSyncedAt: null,
        syncError: null
      })
      await database.updateBlueskyAccountSync({
        actorId: 'actor-a',
        lastSyncedAt: Date.UTC(2026, 0, 2, 3, 4, 5),
        syncError: 'Bluesky ended this session.'
      })
      expect(
        (await getBlueskyAccountState(database, actor('actor-a'))).account
      ).toMatchObject({
        lastSyncedAt: '2026-01-02T03:04:05.000Z',
        syncError: 'Bluesky ended this session.'
      })
      await database.setBlueskySession({ did: DID, session: 's' })
      expect(
        (await getBlueskyAccountState(database, actor('actor-a'))).account
          ?.sessionActive
      ).toBe(true)
    })

    it('saves "Post to Bluesky by default", and refuses it without a link', async () => {
      await expect(
        updateBlueskyCrosspostDefault(database, actor('actor-a'), false)
      ).rejects.toMatchObject({ status: 422 })

      await linkAlice()
      expect(
        (await getBlueskyAccountState(database, actor('actor-a'))).account
          ?.crosspostByDefault
      ).toBe(true)
      await updateBlueskyCrosspostDefault(database, actor('actor-a'), false)
      expect(
        (await getBlueskyAccountState(database, actor('actor-a'))).account
          ?.crosspostByDefault
      ).toBe(false)
    })

    it('checks the handle and the DNS record, and stores the current identity', async () => {
      await linkAlice()
      vi.mocked(resolveTxt).mockResolvedValue([[`did=${DID}`]])
      expect(await checkBlueskyHandle(database, actor('actor-a'))).toEqual({
        handle: 'alice.example.com',
        verified: true,
        dnsRecord: true
      })

      // Unverified: the handle the DID document claims, not handle.invalid.
      const identity = await resolve()
      resolve.mockResolvedValueOnce({
        ...identity,
        handle: 'handle.invalid',
        didDoc: { ...identity.didDoc, alsoKnownAs: ['at://alice.example.org'] }
      })
      vi.mocked(resolveTxt).mockRejectedValue(
        Object.assign(new Error('queryTxt ENODATA'), { code: 'ENODATA' })
      )
      expect(await checkBlueskyHandle(database, actor('actor-a'))).toEqual({
        handle: 'alice.example.org',
        verified: false,
        dnsRecord: false
      })
      expect(
        (await database.getBlueskyAccount({ actorId: 'actor-a' }))?.handle
      ).toBe('alice.example.org')
    })

    it('refuses a handle check when federation policy disallows Bluesky', async () => {
      await linkAlice()
      const block = await database.createDomainBlock({
        domain: 'bsky.app',
        severity: 'suspend'
      })
      try {
        await expect(
          checkBlueskyHandle(database, actor('actor-a'))
        ).rejects.toMatchObject({
          status: 422,
          message: 'This server does not allow Bluesky.'
        })
        expect(resolve).not.toHaveBeenCalled()
        expect(safeRemoteFetch).not.toHaveBeenCalled()
        expect(resolveTxt).not.toHaveBeenCalled()
      } finally {
        await database.deleteDomainBlock(block.id)
      }
    })

    it('lowercases a claimed handle and refuses one that is not a handle', async () => {
      await linkAlice()
      vi.mocked(resolveTxt).mockResolvedValue([])
      const identity = await resolve()
      for (const [alias, stored] of [
        ['at://Alice.Example.ORG', 'alice.example.org'],
        ['at://alice.example.org:8080/path', 'handle.invalid'],
        [`at://${'a'.repeat(250)}.example`, 'handle.invalid'],
        // Valid labels, but longer than a handle may be (253).
        [
          `at://${Array(5).fill('a'.repeat(60)).join('.')}.example`,
          'handle.invalid'
        ]
      ]) {
        resolve.mockResolvedValueOnce({
          ...identity,
          handle: 'handle.invalid',
          didDoc: { ...identity.didDoc, alsoKnownAs: [alias] }
        })
        expect(
          (await checkBlueskyHandle(database, actor('actor-a'))).handle
        ).toBe(stored)
      }
    })

    it('tells a record for another DID, and a DNS failure, from a match', async () => {
      await linkAlice()
      vi.mocked(resolveTxt).mockResolvedValue([['did=did:plc:someoneelse']])
      expect(
        (await checkBlueskyHandle(database, actor('actor-a'))).dnsRecord
      ).toBe(false)

      vi.mocked(resolveTxt).mockRejectedValue(
        Object.assign(new Error('queryTxt ESERVFAIL'), { code: 'ESERVFAIL' })
      )
      expect(
        (await checkBlueskyHandle(database, actor('actor-a'))).dnsRecord
      ).toBeNull()
    })

    it('shows the DNS record when the PDS does not say which domains it hands out', async () => {
      vi.mocked(safeRemoteFetch).mockResolvedValue(respond(500, {}))
      resolve.mockResolvedValueOnce({
        ...(await resolve()),
        handle: 'alice.pds.example.net'
      })
      await linkAlice()
      vi.mocked(resolveTxt).mockResolvedValue([])
      await checkBlueskyHandle(database, actor('actor-a'))
      expect(
        (await database.getBlueskyAccount({ actorId: 'actor-a' }))?.domainHandle
      ).toBe(true)
    })

    it('lets only an admin answer for the domain it lives on, one profile per domain', async () => {
      await linkAlice()
      await expect(
        setBlueskyInstanceHandle(database, actor('actor-a'), true)
      ).rejects.toThrow('admin')

      await setBlueskyInstanceHandle(database, actor('actor-a', 'admin'), true)
      expect(
        (await getBlueskyAccountState(database, actor('actor-a', 'admin')))
          .instanceHandle
      ).toEqual({ host: 'social.example', status: 'yours' })
      expect(
        (
          await database.getBlueskyAccountByInstanceHandle({
            host: 'social.example'
          })
        )?.did
      ).toBe(DID)

      await database.saveBlueskyAccount({
        actorId: 'actor-b',
        did: 'did:plc:other',
        handle: 'bob.example.com',
        pdsUrl: PDS,
        authType: 'oauth',
        domainHandle: true
      })
      expect(
        (await getBlueskyAccountState(database, actor('actor-b', 'admin')))
          .instanceHandle?.status
      ).toBe('taken')
      await expect(
        setBlueskyInstanceHandle(database, actor('actor-b', 'admin'), true)
      ).rejects.toMatchObject({ status: 409 })
    })

    it('lets a holder who is no longer an admin let go of the claim', async () => {
      await linkAlice()
      await setBlueskyInstanceHandle(database, actor('actor-a', 'admin'), true)
      await setBlueskyInstanceHandle(database, actor('actor-a'), false)
      expect(
        (await database.getBlueskyAccount({ actorId: 'actor-a' }))
          ?.instanceHandle
      ).toBeNull()
    })

    it('shows a claim the actor can no longer hold, so it can be let go', async () => {
      await linkAlice()
      await setBlueskyInstanceHandle(database, actor('actor-a', 'admin'), true)
      // No longer an admin: the claim answers nothing but is still shown.
      expect(
        (await getBlueskyAccountState(database, actor('actor-a')))
          .instanceHandle
      ).toEqual({ host: 'social.example', status: 'inactive' })
      // Moved to another domain: the same.
      expect(
        (
          await getBlueskyAccountState(
            database,
            actor('actor-a', 'admin', 'moved.example')
          )
        ).instanceHandle
      ).toEqual({ host: 'social.example', status: 'inactive' })
      await setBlueskyInstanceHandle(database, actor('actor-a'), false)
      expect(
        (await getBlueskyAccountState(database, actor('actor-a')))
          .instanceHandle
      ).toBeNull()
    })

    it('claims each served domain separately', async () => {
      await linkAlice()
      await database.saveBlueskyAccount({
        actorId: 'actor-b',
        did: 'did:plc:other',
        handle: 'bob.example.com',
        pdsUrl: PDS,
        authType: 'oauth',
        domainHandle: true
      })
      await setBlueskyInstanceHandle(database, actor('actor-a', 'admin'), true)
      const other = actor('actor-b', 'admin', 'Other.Example')
      expect(
        (await getBlueskyAccountState(database, other)).instanceHandle
      ).toEqual({ host: 'other.example', status: 'free' })
      await setBlueskyInstanceHandle(database, other, true)
      expect(
        (
          await database.getBlueskyAccountByInstanceHandle({
            host: 'other.example'
          })
        )?.did
      ).toBe('did:plc:other')
      expect(
        (
          await database.getBlueskyAccountByInstanceHandle({
            host: 'social.example'
          })
        )?.did
      ).toBe(DID)
    })

    it('never offers a domain spelled other than its canonical form', async () => {
      await linkAlice()
      for (const domain of ['social.example:443', 'social.example.']) {
        expect(
          (
            await getBlueskyAccountState(
              database,
              actor('actor-a', 'admin', domain)
            )
          ).instanceHandle
        ).toBeNull()
      }
    })

    it('never offers a host with a port', async () => {
      await linkAlice()
      const local = actor('actor-a', 'admin', 'localhost:3000')
      expect(
        (await getBlueskyAccountState(database, local)).instanceHandle
      ).toBeNull()
      await expect(
        setBlueskyInstanceHandle(database, local, true)
      ).rejects.toThrow('cannot be a handle')
    })

    it('counts sign-in starts and app-password tries in the same window', async () => {
      const limited = actor('actor-rate-limit-2')
      vi.mocked(getBlueskyOAuthClient).mockReturnValue(
        Promise.resolve({
          authorize: vi
            .fn()
            .mockResolvedValue(new URL('https://auth.example.net/authorize'))
        }) as never
      )
      vi.mocked(safeRemoteFetch).mockResolvedValue(respond(401, {}))
      for (let i = 0; i < 10; i++) {
        await startBlueskyOAuth(database, limited, 'alice.example.com')
        await linkBlueskyAppPassword(database, limited, {
          identifier: 'alice.example.com',
          password: 'abcd-efgh-ijkl-mnop'
        }).catch(() => undefined)
      }
      await expect(
        linkBlueskyAppPassword(database, limited, {
          identifier: 'alice.example.com',
          password: 'abcd-efgh-ijkl-mnop'
        })
      ).rejects.toMatchObject({ status: 429 })
      await expect(
        startBlueskyOAuth(database, limited, 'alice.example.com')
      ).rejects.toMatchObject({ status: 429 })
    })

    it('limits how often one actor reaches other servers', async () => {
      const limited = actor('actor-rate-limit')
      await database.saveBlueskyAccount({
        actorId: limited.id,
        did: 'did:plc:ratelimit',
        handle: 'alice.example.com',
        pdsUrl: PDS,
        authType: 'oauth',
        domainHandle: true
      })
      vi.mocked(resolveTxt).mockResolvedValue([])
      for (let i = 0; i < 20; i++) {
        await checkBlueskyHandle(database, limited)
      }
      await expect(checkBlueskyHandle(database, limited)).rejects.toMatchObject(
        { status: 429 }
      )
      await database.deleteBlueskyAccount({ actorId: limited.id })
    })

    it('unlinks', async () => {
      await linkAlice()
      await unlinkBluesky(database, actor('actor-a'))
      expect(
        await database.getBlueskyAccount({ actorId: 'actor-a' })
      ).toBeNull()
    })
  })
})
