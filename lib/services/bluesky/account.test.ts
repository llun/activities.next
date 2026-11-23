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
  unlinkBluesky
} from '@/lib/services/bluesky/account'
import {
  createBlueskyIdentityResolver,
  getBlueskyOAuthClient,
  writeStoredBlueskySession
} from '@/lib/services/bluesky/client'
import type { Actor } from '@/lib/types/domain/actor'
import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'

vi.mock('node:dns/promises', () => ({ resolveTxt: vi.fn() }))
vi.mock('@/lib/config', () => ({ getConfig: vi.fn() }))
vi.mock('@/lib/utils/safeRemoteFetch', () => ({ safeRemoteFetch: vi.fn() }))
vi.mock('@/lib/services/bluesky/client', () => ({
  BLUESKY_OAUTH_SCOPE: 'atproto transition:generic',
  createBlueskyIdentityResolver: vi.fn(),
  getBlueskyOAuthClient: vi.fn(),
  writeStoredBlueskySession: vi.fn()
}))

const DID = 'did:plc:abc123'
const PDS = 'https://pds.example.net/'

const actor = (id: string, role?: 'admin', domain = 'social.example') =>
  ({ id, domain, account: { id: `${id}-account`, role } }) as unknown as Actor

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

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
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
            accessJwt: 'access',
            refreshJwt: 'refresh'
          })
    )
  })

  afterEach(async () => {
    vi.clearAllMocks()
    for (const id of ['actor-a', 'actor-b']) {
      await database.deleteBlueskyAccount({ actorId: id })
    }
  })

  describe('linkBlueskyAppPassword', () => {
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
        accessJwt: 'access',
        refreshJwt: 'refresh'
      })
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

    it('reports a server error, not a user message, when sign-in fails for another reason', async () => {
      vi.mocked(getBlueskyOAuthClient).mockReturnValue(
        Promise.resolve({
          authorize: vi.fn().mockRejectedValue(new Error('database down'))
        }) as never
      )
      await expect(
        startBlueskyOAuth(database, actor('actor-a'), 'alice.example.com')
      ).rejects.toThrow('database down')
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
      ).toMatchObject({ did: DID, sessionActive: false })
      await database.setBlueskySession({ did: DID, session: 's' })
      expect(
        (await getBlueskyAccountState(database, actor('actor-a'))).account
          ?.sessionActive
      ).toBe(true)
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

    it('unlinks', async () => {
      await linkAlice()
      await unlinkBluesky(database, actor('actor-a'))
      expect(
        await database.getBlueskyAccount({ actorId: 'actor-a' })
      ).toBeNull()
    })
  })
})
