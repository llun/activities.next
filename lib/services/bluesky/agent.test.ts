import { TokenRefreshError } from '@atproto/oauth-client-node'

import { getConfig } from '@/lib/config'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  BlueskySessionChangedError,
  BlueskySessionEndedError,
  BlueskyUnexpectedAnswerError,
  getBlueskyAgent,
  loadHostedAgent
} from '@/lib/services/bluesky/agent'
import {
  getBlueskyOAuthClient,
  readStoredBlueskySession,
  writeStoredBlueskySession
} from '@/lib/services/bluesky/client'
import type { Actor } from '@/lib/types/domain/actor'
import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'

vi.mock('@/lib/config', () => ({ getConfig: vi.fn() }))
vi.mock('@/lib/utils/safeRemoteFetch', () => ({ safeRemoteFetch: vi.fn() }))
vi.mock('@/lib/services/bluesky/client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getBlueskyOAuthClient: vi.fn()
}))

const DID = 'did:plc:agent123'
const PDS = 'https://pds.example.net/'
const actor = {
  id: 'actor-agent',
  domain: 'Social.Example'
} as unknown as Actor

const respond = (statusCode: number, body: unknown = {}) => ({
  statusCode,
  body: JSON.stringify(body),
  bodyTruncated: false,
  headers: {},
  url: ''
})

describe('getBlueskyAgent', () => {
  const testDb = createTestDatabase()
  const { database } = testDb

  const link = (authType: 'oauth' | 'app_password') =>
    database.saveBlueskyAccount({
      actorId: actor.id,
      did: DID,
      handle: 'alice.example.com',
      pdsUrl: PDS,
      authType,
      domainHandle: true
    })
  const storeAppPassword = (accessJwt = 'access-1', refreshJwt = 'refresh-1') =>
    writeStoredBlueskySession(database, DID, {
      type: 'app_password',
      accessJwt,
      refreshJwt
    })

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
    await testDb.db
      .insertInto('accounts')
      .values({ id: 'account-agent' })
      .execute()
    await testDb.db
      .insertInto('actors')
      .values({
        id: actor.id,
        accountId: 'account-agent',
        username: 'agent',
        domain: 'social.example'
      })
      .execute()
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    vi.mocked(getConfig).mockReturnValue({
      host: 'social.example',
      secretPhase: 'secret',
      bluesky: { oauthPrivateKeys: [] }
    } as never)
  })

  afterEach(async () => {
    vi.resetAllMocks()
    await database.deleteBlueskyAccount({ actorId: actor.id })
    await database.deleteBlueskySession({ did: DID })
  })

  it('returns null without a linked account or a stored session', async () => {
    expect(await getBlueskyAgent(database, actor)).toBeNull()
    await link('app_password')
    expect(await getBlueskyAgent(database, actor)).toBeNull()
  })

  describe('app password', () => {
    beforeEach(async () => {
      await link('app_password')
      await storeAppPassword()
    })

    it('calls the PDS with the bearer token and repeats array params', async () => {
      vi.mocked(safeRemoteFetch).mockResolvedValue(respond(200, { feed: [] }))
      const agent = await getBlueskyAgent(database, actor)
      expect(agent).toMatchObject({ did: DID, pdsUrl: PDS })

      const result = await agent!.get('app.bsky.feed.getTimeline', {
        limit: 50,
        cursor: undefined,
        uris: ['at://a', 'at://b']
      })

      expect(result).toEqual({ feed: [] })
      expect(safeRemoteFetch).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://pds.example.net/xrpc/app.bsky.feed.getTimeline?limit=50&uris=at%3A%2F%2Fa&uris=at%3A%2F%2Fb',
          method: 'GET',
          headers: { Authorization: 'Bearer access-1' },
          maxRedirects: 0
        })
      )
    })

    it('posts a JSON body', async () => {
      vi.mocked(safeRemoteFetch).mockResolvedValue(respond(200, { uri: 'x' }))
      const agent = await getBlueskyAgent(database, actor)
      await agent!.post('com.atproto.repo.createRecord', { a: 1 })
      expect(safeRemoteFetch).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://pds.example.net/xrpc/com.atproto.repo.createRecord',
          method: 'POST',
          body: '{"a":1}',
          headers: {
            Authorization: 'Bearer access-1',
            'Content-Type': 'application/json'
          }
        })
      )
    })

    it('refreshes an expired access token once, stores it and retries', async () => {
      vi.mocked(safeRemoteFetch).mockImplementation(
        async ({ url, headers }) => {
          const auth = (headers as Record<string, string>).Authorization
          if (url.endsWith('refreshSession')) {
            expect(auth).toBe('Bearer refresh-1')
            return respond(200, {
              did: DID,
              accessJwt: 'access-2',
              refreshJwt: 'refresh-2'
            })
          }
          return auth === 'Bearer access-1'
            ? respond(400, { error: 'ExpiredToken', message: 'Token expired' })
            : respond(200, { ok: true })
        }
      )
      const agent = await getBlueskyAgent(database, actor)

      expect(await agent!.get('app.bsky.feed.getTimeline')).toEqual({
        ok: true
      })
      expect(await agent!.get('app.bsky.feed.getTimeline')).toEqual({
        ok: true
      })

      const urls = vi.mocked(safeRemoteFetch).mock.calls.map(([o]) => o.url)
      expect(urls.filter((url) => url.endsWith('refreshSession'))).toHaveLength(
        1
      )
      expect(urls).toHaveLength(4)
      expect(await readStoredBlueskySession(database, DID)).toEqual({
        type: 'app_password',
        accessJwt: 'access-2',
        refreshJwt: 'refresh-2'
      })
    })

    it('refreshes only once for concurrent expired calls', async () => {
      vi.mocked(safeRemoteFetch).mockImplementation(
        async ({ url, headers }) => {
          const auth = (headers as Record<string, string>).Authorization
          if (url.endsWith('refreshSession')) {
            await new Promise((resolve) => setTimeout(resolve, 50))
            return respond(200, {
              did: DID,
              accessJwt: 'access-2',
              refreshJwt: 'refresh-2'
            })
          }
          return auth === 'Bearer access-1'
            ? respond(401, { error: 'ExpiredToken' })
            : respond(200, { ok: true })
        }
      )
      // Two agents, like two server instances, each holding the old token.
      const [first, second] = await Promise.all([
        getBlueskyAgent(database, actor),
        getBlueskyAgent(database, actor)
      ])

      await expect(
        Promise.all([
          first!.get('app.bsky.feed.getTimeline'),
          second!.get('app.bsky.feed.getTimeline')
        ])
      ).resolves.toEqual([{ ok: true }, { ok: true }])

      const refreshes = vi
        .mocked(safeRemoteFetch)
        .mock.calls.filter(([o]) => o.url.endsWith('refreshSession'))
      expect(refreshes).toHaveLength(1)
    })

    it('keeps a session relinked with OAuth while an expired request ran', async () => {
      const agent = await getBlueskyAgent(database, actor)
      vi.mocked(safeRemoteFetch).mockImplementation(async () => {
        // The user relinks with OAuth between the request and its refresh.
        await writeStoredBlueskySession(database, DID, {
          type: 'oauth',
          session: { relinked: true } as never
        })
        return respond(400, { error: 'ExpiredToken' })
      })

      const error = await agent!
        .get('app.bsky.feed.getTimeline')
        .catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(BlueskySessionChangedError)
      expect(await readStoredBlueskySession(database, DID)).toMatchObject({
        type: 'oauth'
      })
    })

    it('ends and deletes the session when the refresh is refused', async () => {
      // The request and the refresh both answer ExpiredToken.
      vi.mocked(safeRemoteFetch).mockResolvedValue(
        respond(400, { error: 'ExpiredToken' })
      )
      const agent = await getBlueskyAgent(database, actor)

      await expect(
        agent!.get('app.bsky.feed.getTimeline')
      ).rejects.toBeInstanceOf(BlueskySessionEndedError)
      expect(await database.getBlueskySession({ did: DID })).toBeNull()
      // The link stays: Settings shows the ended session.
      expect(await database.getBlueskyAccount({ actorId: actor.id })).not.toBe(
        null
      )
    })

    it('reports an XRPC error without the token or the body sent', async () => {
      vi.mocked(safeRemoteFetch).mockResolvedValue(
        respond(400, { error: 'InvalidRequest', message: 'Bad cursor' })
      )
      const agent = await getBlueskyAgent(database, actor)

      const error = await agent!
        .post('com.atproto.repo.createRecord', { secret: 'sent-body' })
        .catch((e: Error) => e)

      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain('InvalidRequest')
      expect((error as Error).message).toContain('Bad cursor')
      expect((error as Error).message).not.toContain('access-1')
      expect((error as Error).message).not.toContain('sent-body')
      expect(await database.getBlueskySession({ did: DID })).not.toBeNull()
    })

    it('uploads raw bytes with their content type', async () => {
      const cid = 'bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5ua2r7w7v4v4v4v4v4v4'
      vi.mocked(safeRemoteFetch).mockResolvedValue(
        respond(200, {
          blob: {
            $type: 'blob',
            ref: { $link: cid },
            mimeType: 'image/jpeg',
            size: 3
          }
        })
      )
      const agent = await getBlueskyAgent(database, actor)
      const bytes = new Uint8Array([1, 2, 3])

      expect(await agent!.uploadBlob(bytes, 'image/jpeg')).toEqual({
        $type: 'blob',
        ref: { $link: cid },
        mimeType: 'image/jpeg',
        size: 3
      })
      expect(safeRemoteFetch).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://pds.example.net/xrpc/com.atproto.repo.uploadBlob',
          method: 'POST',
          bodyBytes: bytes,
          headers: {
            Authorization: 'Bearer access-1',
            'Content-Type': 'image/jpeg'
          }
        })
      )
    })

    it('rejects an upload answer without a blob reference', async () => {
      vi.mocked(safeRemoteFetch).mockResolvedValue(
        respond(200, {
          blob: {
            ref: { $link: 'not-a-cid' },
            mimeType: 'image/jpeg',
            size: 3
          }
        })
      )
      const agent = await getBlueskyAgent(database, actor)

      await expect(
        agent!.uploadBlob(new Uint8Array([1]), 'image/jpeg')
      ).rejects.toBeInstanceOf(BlueskyUnexpectedAnswerError)
    })
  })

  describe('OAuth', () => {
    const fetchHandler = vi.fn()
    const restore = vi.fn()

    beforeEach(async () => {
      await link('oauth')
      await writeStoredBlueskySession(database, DID, {
        type: 'oauth',
        session: {} as never
      })
      restore.mockResolvedValue({ fetchHandler })
      vi.mocked(getBlueskyOAuthClient).mockReturnValue(
        Promise.resolve({ restore } as never)
      )
    })

    it('calls fetchHandler through the client of the canonical domain', async () => {
      fetchHandler.mockResolvedValue(
        new Response(JSON.stringify({ feed: [] }), { status: 200 })
      )
      const agent = await getBlueskyAgent(database, actor)

      expect(
        await agent!.get('app.bsky.feed.getTimeline', { limit: 10 })
      ).toEqual({ feed: [] })
      expect(getBlueskyOAuthClient).toHaveBeenCalledWith(
        database,
        'social.example'
      )
      expect(restore).toHaveBeenCalledWith(DID)
      expect(fetchHandler).toHaveBeenCalledWith(
        '/xrpc/app.bsky.feed.getTimeline?limit=10',
        { method: 'GET' }
      )
    })

    it('maps a refused refresh to an ended session and deletes it', async () => {
      restore.mockRejectedValue(new TokenRefreshError(DID, 'refused'))
      const agent = await getBlueskyAgent(database, actor)

      await expect(
        agent!.get('app.bsky.feed.getTimeline')
      ).rejects.toBeInstanceOf(BlueskySessionEndedError)
      expect(await database.getBlueskySession({ did: DID })).toBeNull()
    })

    it('uploads raw bytes through fetchHandler', async () => {
      const cid = 'bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5ua2r7w7v4v4v4v4v4v4'
      fetchHandler.mockResolvedValue(
        new Response(
          JSON.stringify({
            blob: {
              $type: 'blob',
              ref: { $link: cid },
              mimeType: 'image/png',
              size: 3
            }
          }),
          { status: 200 }
        )
      )
      const agent = await getBlueskyAgent(database, actor)
      const bytes = new Uint8Array([1, 2, 3])

      expect(await agent!.uploadBlob(bytes, 'image/png')).toEqual({
        $type: 'blob',
        ref: { $link: cid },
        mimeType: 'image/png',
        size: 3
      })
      expect(fetchHandler).toHaveBeenCalledWith(
        '/xrpc/com.atproto.repo.uploadBlob',
        {
          method: 'POST',
          body: bytes,
          headers: { 'Content-Type': 'image/png' }
        }
      )
    })

    it('keeps a session relinked with an app password while the request ran', async () => {
      restore.mockImplementation(async () => {
        // The user relinks with an app password between the request and its
        // refresh, so the library no longer sees an OAuth session.
        await writeStoredBlueskySession(database, DID, {
          type: 'app_password',
          accessJwt: 'access-2',
          refreshJwt: 'refresh-2'
        })
        throw new TokenRefreshError(DID, 'refused')
      })
      const agent = await getBlueskyAgent(database, actor)

      const error = await agent!
        .get('app.bsky.feed.getTimeline')
        .catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(BlueskySessionChangedError)
      expect(await readStoredBlueskySession(database, DID)).toMatchObject({
        type: 'app_password',
        accessJwt: 'access-2'
      })
    })
  })
})

describe('loadHostedAgent', () => {
  const failing = (error: unknown) => () => Promise.reject(error)

  it('explains the CommonJS resolution failures of the hosted client', async () => {
    for (const code of [
      'ERR_MODULE_NOT_FOUND',
      'ERR_PACKAGE_PATH_NOT_EXPORTED',
      'ERR_REQUIRE_ESM'
    ]) {
      const cause = Object.assign(new Error('cannot load'), { code })
      await expect(loadHostedAgent(failing(cause))).rejects.toMatchObject({
        message: expect.stringContaining('cannot be served from this process'),
        cause
      })
    }
  })

  it('rethrows any other load failure unchanged', async () => {
    const broken = new TypeError('the module threw while loading')
    await expect(loadHostedAgent(failing(broken))).rejects.toBe(broken)
    const coded = Object.assign(new Error('disk'), { code: 'EIO' })
    await expect(loadHostedAgent(failing(coded))).rejects.toBe(coded)
  })

  it('answers the hosted client module', async () => {
    expect(typeof (await loadHostedAgent()).createHostedBlueskyAgent).toBe(
      'function'
    )
  })
})
