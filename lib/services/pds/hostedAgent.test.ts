import { Secp256k1Keypair, verifySignature } from '@atproto/crypto'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { blueskyActionFailure } from '@/lib/services/bluesky/actionErrors'
import {
  BlueskyHostedAccountInactiveError,
  BlueskyRequestError,
  BlueskySessionEndedError,
  getBlueskyAgent
} from '@/lib/services/bluesky/agent'
import { crosspostStatus } from '@/lib/services/bluesky/crosspost'
import { followBlueskyActor } from '@/lib/services/bluesky/follow'
import { likeBlueskyPost } from '@/lib/services/bluesky/interactions'
import { blueskyActorId } from '@/lib/services/bluesky/records'
import { syncBlueskyHome } from '@/lib/services/bluesky/sync'
import { createPdsRepo } from '@/lib/services/pds'
import { decodePdsEvent } from '@/lib/services/pds/events'
import { storeBlueskyPost } from '@/lib/stub/blueskyPost'
import { TEST_DOMAIN, TEST_PASSWORD_HASH } from '@/lib/stub/const'
import type { Actor } from '@/lib/types/domain/actor'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import {
  type SafeRemoteFetchOptions,
  safeRemoteFetch
} from '@/lib/utils/safeRemoteFetch'

vi.mock('@/lib/utils/safeRemoteFetch', () => ({ safeRemoteFetch: vi.fn() }))
vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn(() => ({
    publish: vi.fn().mockResolvedValue(undefined),
    runsInline: false
  }))
}))
vi.mock('@/lib/services/timelines', () => ({
  addStatusToTimelines: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('@/lib/services/domains/servedDomainSnapshot', async (original) => ({
  ...(await original<object>()),
  getServedHostConfig: () => ({})
}))

const APPVIEW = 'https://api.bsky.app'
const USERNAMES = [
  'hosted-agent-local',
  'hosted-agent-appview',
  'hosted-agent-off',
  'hosted-agent-suspended',
  'hosted-agent-crosspost',
  'hosted-agent-like',
  'hosted-agent-follow',
  'hosted-agent-sync',
  'hosted-agent-off-copy'
]

const json = (body: unknown, statusCode = 200) => ({
  body: body === undefined ? '' : JSON.stringify(body),
  bodyTruncated: false,
  headers: {},
  statusCode,
  url: ''
})

const decodeJwt = (token: string) => {
  const [header, payload, signature] = token.split('.')
  return {
    header: JSON.parse(Buffer.from(header, 'base64url').toString('utf8')),
    payload: JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
    signingInput: Buffer.from(`${header}.${payload}`, 'utf8'),
    signature: Buffer.from(signature, 'base64url')
  }
}

describe('hosted Bluesky client', () => {
  const testDb = createTestDatabase()
  const { database } = testDb
  const originalPdsEnv = process.env.ACTIVITIES_BLUESKY_PDS
  // Each test's AppView answers, by method nsid.
  let appView: Record<string, (options: SafeRemoteFetchOptions) => unknown>

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
  })

  beforeEach(() => {
    process.env.ACTIVITIES_BLUESKY_PDS = JSON.stringify({
      [TEST_DOMAIN]: {
        enabled: true,
        hostname: `pds.${TEST_DOMAIN}`,
        allowEmails: [],
        allowActors: USERNAMES.map((name) => `${name}@${TEST_DOMAIN}`)
      }
    })
    appView = {}
    vi.mocked(safeRemoteFetch).mockReset()
    vi.mocked(safeRemoteFetch).mockImplementation(async (options) => {
      const url = new URL(options.url)
      const nsid = url.pathname.replace('/xrpc/', '')
      const answer = appView[nsid]
      if (url.origin !== APPVIEW || !answer) {
        throw new Error(`Unexpected request ${options.url}`)
      }
      return json(answer(options))
    })
  })

  afterAll(async () => {
    if (originalPdsEnv === undefined) {
      delete process.env.ACTIVITIES_BLUESKY_PDS
    } else {
      process.env.ACTIVITIES_BLUESKY_PDS = originalPdsEnv
    }
    await database.destroy()
  })

  // A local actor with a hosted repo and its `hosted` bluesky_accounts row.
  const createHosted = async (username: string) => {
    await database.createAccount({
      email: `${username}@${TEST_DOMAIN}`,
      username,
      passwordHash: TEST_PASSWORD_HASH,
      domain: TEST_DOMAIN,
      privateKey: `ap-priv-${username}`,
      publicKey: `ap-pub-${username}`
    })
    const actor = (await database.getActorFromUsername({
      username,
      domain: TEST_DOMAIN
    })) as Actor
    const did = `did:plc:${username
      .replace(/[^a-z]/g, '')
      .padEnd(24, 'a')
      .slice(0, 24)}`
    const signingKey = await Secp256k1Keypair.create({ exportable: true })
    const handle = `${username}.pds.${TEST_DOMAIN}`
    await createPdsRepo(database, {
      did,
      actorId: actor.id,
      domain: TEST_DOMAIN,
      handle,
      signingKey
    })
    await database.saveBlueskyAccount({
      actorId: actor.id,
      did,
      handle,
      pdsUrl: `https://pds.${TEST_DOMAIN}`,
      authType: 'hosted',
      domainHandle: false,
      crosspostByDefault: false
    })
    const agent = await getBlueskyAgent(database, actor)
    if (!agent) throw new Error('No hosted agent')
    return { actor, did, handle, signingKey, agent }
  }

  const appViewCalls = () =>
    vi.mocked(safeRemoteFetch).mock.calls.map(([options]) => options)

  it('answers repo writes, reads and preferences from the local PDS', async () => {
    const { did, handle, agent } = await createHosted('hosted-agent-local')
    expect(agent.did).toBe(did)
    expect(agent.pdsUrl).toBe(`https://pds.${TEST_DOMAIN}`)

    const created = await agent.post<{
      uri: string
      cid: string
      commit: { cid: string; rev: string }
    }>('com.atproto.repo.createRecord', {
      repo: did,
      collection: 'app.bsky.feed.post',
      rkey: '3kpost',
      record: {
        $type: 'app.bsky.feed.post',
        text: 'hi',
        createdAt: new Date().toISOString()
      }
    })
    expect(created.uri).toBe(`at://${did}/app.bsky.feed.post/3kpost`)
    expect(created.cid).toMatch(/^bafyrei/)
    expect(created.commit).toEqual({
      cid: expect.any(String),
      rev: expect.any(String)
    })

    // A second create at the same key is refused the way a PDS refuses it.
    await expect(
      agent.post('com.atproto.repo.createRecord', {
        repo: did,
        collection: 'app.bsky.feed.post',
        rkey: '3kpost',
        record: { $type: 'app.bsky.feed.post', text: 'again', createdAt: '' }
      })
    ).rejects.toBeInstanceOf(BlueskyRequestError)

    expect(
      await agent.get('com.atproto.repo.getRecord', {
        repo: did,
        collection: 'app.bsky.feed.post',
        rkey: '3kpost'
      })
    ).toMatchObject({
      uri: created.uri,
      cid: created.cid,
      value: { text: 'hi' }
    })
    await expect(
      agent.get('com.atproto.repo.getRecord', {
        repo: did,
        collection: 'app.bsky.feed.post',
        rkey: 'missing'
      })
    ).rejects.toMatchObject({ status: 400, error: 'RecordNotFound' })

    const updated = await agent.post<{ uri: string; cid: string }>(
      'com.atproto.repo.putRecord',
      {
        repo: did,
        collection: 'app.bsky.actor.profile',
        rkey: 'self',
        record: { $type: 'app.bsky.actor.profile', displayName: 'Alice' }
      }
    )
    expect(updated.uri).toBe(`at://${did}/app.bsky.actor.profile/self`)

    const applied = await agent.post<{
      commit: { cid: string; rev: string }
      results: unknown[]
    }>('com.atproto.repo.applyWrites', {
      repo: did,
      writes: [
        {
          $type: 'com.atproto.repo.applyWrites#create',
          collection: 'app.bsky.feed.like',
          rkey: '3klike',
          value: {
            $type: 'app.bsky.feed.like',
            subject: { uri: created.uri, cid: created.cid },
            createdAt: new Date().toISOString()
          }
        },
        {
          $type: 'com.atproto.repo.applyWrites#delete',
          collection: 'app.bsky.feed.post',
          rkey: '3kpost'
        }
      ]
    })
    expect(applied.results).toEqual([
      {
        $type: 'com.atproto.repo.applyWrites#createResult',
        uri: `at://${did}/app.bsky.feed.like/3klike`,
        cid: expect.any(String)
      },
      { $type: 'com.atproto.repo.applyWrites#deleteResult' }
    ])

    expect(
      await agent.get('com.atproto.repo.listRecords', {
        repo: did,
        collection: 'app.bsky.feed.like',
        limit: 10
      })
    ).toMatchObject({
      records: [{ uri: `at://${did}/app.bsky.feed.like/3klike` }]
    })
    expect(
      await agent.post('com.atproto.repo.deleteRecord', {
        repo: did,
        collection: 'app.bsky.feed.like',
        rkey: '3klike'
      })
    ).toEqual({ commit: { cid: expect.any(String), rev: expect.any(String) } })
    // Deleting a record that is gone is a no-op, as on a PDS.
    expect(
      await agent.post('com.atproto.repo.deleteRecord', {
        repo: did,
        collection: 'app.bsky.feed.like',
        rkey: '3klike'
      })
    ).toEqual({})
    expect(
      await agent.get('com.atproto.repo.describeRepo', { repo: did })
    ).toMatchObject({ did, handle, handleIsCorrect: true })

    expect(await agent.get('app.bsky.actor.getPreferences')).toEqual({
      preferences: []
    })
    const preferences = [
      { $type: 'app.bsky.actor.defs#adultContentPref', enabled: false }
    ]
    await agent.post('app.bsky.actor.putPreferences', { preferences })
    expect(await agent.get('app.bsky.actor.getPreferences')).toEqual({
      preferences
    })

    // Another repo, and anything outside repo and app.bsky, are refused.
    const other = 'did:plc:someoneelseaaaaaaaaaaaaa'
    const record = { $type: 'app.bsky.feed.post', text: 'x', createdAt: '' }
    for (const call of [
      () =>
        agent.get('com.atproto.repo.getRecord', {
          repo: other,
          collection: 'app.bsky.feed.post',
          rkey: 'x'
        }),
      () =>
        agent.get('com.atproto.repo.listRecords', {
          repo: other,
          collection: 'app.bsky.feed.post'
        }),
      () => agent.get('com.atproto.repo.describeRepo', { repo: other }),
      () =>
        agent.post('com.atproto.repo.createRecord', {
          repo: other,
          collection: 'app.bsky.feed.post',
          record
        }),
      () =>
        agent.post('com.atproto.repo.putRecord', {
          repo: other,
          collection: 'app.bsky.feed.post',
          rkey: 'x',
          record
        }),
      () =>
        agent.post('com.atproto.repo.deleteRecord', {
          repo: other,
          collection: 'app.bsky.feed.post',
          rkey: 'x'
        }),
      () =>
        agent.post('com.atproto.repo.applyWrites', {
          repo: other,
          writes: [
            {
              $type: 'com.atproto.repo.applyWrites#create',
              collection: 'app.bsky.feed.post',
              value: record
            }
          ]
        })
    ]) {
      await expect(call()).rejects.toMatchObject({
        status: 400,
        error: 'InvalidRequest',
        message: expect.stringContaining(`Only ${did}`)
      })
    }
    // A method name that is not an NSID never reaches the AppView.
    for (const nsid of ['app.bsky.feed.get timeline', 'app.bsky.feed/../x']) {
      await expect(agent.get(nsid)).rejects.toMatchObject({
        status: 400,
        error: 'InvalidRequest'
      })
      await expect(agent.post(nsid, {})).rejects.toMatchObject({
        status: 400,
        error: 'InvalidRequest'
      })
    }
    expect(
      await database.listPdsRecords({ did, collection: 'app.bsky.feed.post' })
    ).toEqual({ records: [] })
    await expect(
      agent.get('com.atproto.server.getSession')
    ).rejects.toMatchObject({ status: 501, error: 'MethodNotImplemented' })
    await expect(
      agent.post('chat.bsky.convo.sendMessage', {})
    ).rejects.toMatchObject({ status: 501 })

    expect(safeRemoteFetch).not.toHaveBeenCalled()
  })

  it('stores an uploaded blob in the local PDS and answers its blob ref', async () => {
    const { agent } = await createHosted('hosted-agent-appview')
    const blobs = await import('@/lib/services/pds/blobs')
    const upload = vi.spyOn(blobs, 'uploadPdsBlob').mockResolvedValue({
      cid: 'bafkreiexample',
      mimeType: 'image/png',
      size: 3,
      storageKey: 'pds-blobs/x/y',
      blob: {} as never
    })
    expect(
      await agent.uploadBlob(new Uint8Array([1, 2, 3]), 'image/png')
    ).toEqual({
      $type: 'blob',
      ref: { $link: 'bafkreiexample' },
      mimeType: 'image/png',
      size: 3
    })
    expect(upload).toHaveBeenCalledWith(database, {
      did: agent.did,
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png'
    })
    upload.mockRestore()

    // Other app.bsky calls go to the AppView with a service-auth token for
    // the account, bound to the method.
    const signingKey = (await database.getPdsRepo({ did: agent.did }))!
      .signingKeyDid
    appView['app.bsky.feed.getTimeline'] = () => ({ feed: [] })
    appView['app.bsky.notification.updateSeen'] = () => undefined
    expect(await agent.get('app.bsky.feed.getTimeline', { limit: 50 })).toEqual(
      { feed: [] }
    )
    await agent.post('app.bsky.notification.updateSeen', {
      seenAt: '2026-11-25T00:00:00.000Z'
    })

    const [getCall, postCall] = appViewCalls()
    expect(getCall).toMatchObject({ method: 'GET', maxRedirects: 0 })
    expect(getCall.maxBodyBytes).toBeGreaterThan(0)
    expect(getCall.timeoutInMilliseconds).toBeGreaterThan(0)
    expect(getCall.url).toBe(
      `${APPVIEW}/xrpc/app.bsky.feed.getTimeline?limit=50`
    )
    expect(postCall).toMatchObject({
      method: 'POST',
      maxRedirects: 0,
      body: JSON.stringify({ seenAt: '2026-11-25T00:00:00.000Z' })
    })
    for (const [call, lxm] of [
      [getCall, 'app.bsky.feed.getTimeline'],
      [postCall, 'app.bsky.notification.updateSeen']
    ] as const) {
      const authorization = (call.headers as Record<string, string>)
        .Authorization
      expect(authorization).toMatch(/^Bearer /)
      const token = decodeJwt(authorization.slice('Bearer '.length))
      expect(token.header).toEqual({ typ: 'JWT', alg: 'ES256K' })
      expect(token.payload).toMatchObject({
        iss: agent.did,
        aud: 'did:web:api.bsky.app',
        lxm
      })
      expect(token.payload.exp - token.payload.iat).toBe(60)
      expect(
        await verifySignature(signingKey, token.signingInput, token.signature)
      ).toBe(true)
    }

    // A refusal is the error an outside PDS's refusal is.
    vi.mocked(safeRemoteFetch).mockResolvedValueOnce(
      json({ error: 'InvalidRequest', message: 'bad cursor' }, 400)
    )
    await expect(
      agent.get('app.bsky.feed.getTimeline', { cursor: 'x' })
    ).rejects.toMatchObject({ status: 400, error: 'InvalidRequest' })
  })

  it('ends the session for every call while the account is off', async () => {
    const { did, agent } = await createHosted('hosted-agent-off')
    await database.updatePdsRepoStatus({ did, status: 'deactivated' })
    appView['app.bsky.feed.getTimeline'] = () => ({ feed: [] })

    for (const call of [
      () => agent.get('app.bsky.feed.getTimeline'),
      () => agent.get('app.bsky.actor.getPreferences'),
      () =>
        agent.get('com.atproto.repo.getRecord', {
          repo: did,
          collection: 'app.bsky.feed.post',
          rkey: 'x'
        }),
      () =>
        agent.post('com.atproto.repo.createRecord', {
          repo: did,
          collection: 'app.bsky.feed.post',
          record: { $type: 'app.bsky.feed.post', text: 'x', createdAt: '' }
        }),
      () => agent.uploadBlob(new Uint8Array([1]), 'image/png')
    ]) {
      await expect(call()).rejects.toBeInstanceOf(BlueskySessionEndedError)
    }
    expect(safeRemoteFetch).not.toHaveBeenCalled()
  })

  it('tells the owner to turn a hosted account back on, not to link again', async () => {
    const { actor, did, agent } = await createHosted('hosted-agent-off-copy')
    await database.updatePdsRepoStatus({ did, status: 'deactivated' })
    const off =
      'Your Bluesky account on this server is off. Turn it on under “Host my Bluesky account here”.'
    await expect(agent.get('app.bsky.feed.getTimeline')).rejects.toThrow(off)

    await syncBlueskyHome(database, actor)
    expect(
      (await database.getBlueskyAccount({ actorId: actor.id }))?.syncError
    ).toBe(off)

    const statusId = `${actor.id}/statuses/hosted-off-crosspost`
    await database.createNote({
      id: statusId,
      url: `https://${TEST_DOMAIN}/@${actor.username}/hosted-off-crosspost`,
      actorId: actor.id,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'Not while off'
    })
    await database.claimBlueskyCrosspost({ statusId, actorId: actor.id })
    await crosspostStatus(database, statusId).catch(() => undefined)
    expect(await database.getBlueskyCrosspost({ statusId })).toMatchObject({
      state: 'failed',
      error: off
    })
    expect(
      blueskyActionFailure(
        new BlueskyHostedAccountInactiveError('deactivated'),
        { lockPrefix: 'x', busy: 'busy' }
      )
    ).toEqual({
      status: 422,
      error: off
    })
    expect(safeRemoteFetch).not.toHaveBeenCalled()
  })

  it('ends the session while the profile is suspended', async () => {
    const { actor, did, agent } = await createHosted('hosted-agent-suspended')
    await database.applyModerationAction({
      targetActorId: actor.id,
      accountId: actor.account!.id,
      action: 'suspend',
      moderatorAccountId: 'moderator'
    })
    await expect(agent.get('app.bsky.feed.getTimeline')).rejects.toThrow(
      'Your Bluesky account on this server is suspended.'
    )
    await expect(
      agent.post('com.atproto.repo.createRecord', {
        repo: did,
        collection: 'app.bsky.feed.post',
        record: { $type: 'app.bsky.feed.post', text: 'x', createdAt: '' }
      })
    ).rejects.toBeInstanceOf(BlueskySessionEndedError)
    expect(safeRemoteFetch).not.toHaveBeenCalled()
  })

  it('cross-posts a local post into the hosted repo, which emits a commit', async () => {
    const { actor, did } = await createHosted('hosted-agent-crosspost')
    const statusId = `${actor.id}/statuses/hosted-crosspost`
    await database.createNote({
      id: statusId,
      url: `https://${TEST_DOMAIN}/@${actor.username}/hosted-crosspost`,
      actorId: actor.id,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'Hello from the hosted PDS'
    })
    await database.claimBlueskyCrosspost({ statusId, actorId: actor.id })

    await crosspostStatus(database, statusId)

    const crosspost = await database.getBlueskyCrosspost({ statusId })
    expect(crosspost?.state).toBe('posted')
    expect(crosspost?.uri).toMatch(
      new RegExp(`^at://${did}/app\\.bsky\\.feed\\.post/`)
    )
    const rkey = crosspost!.uri!.split('/').at(-1)!
    expect(
      await database.getPdsRecord({
        did,
        collection: 'app.bsky.feed.post',
        rkey
      })
    ).toMatchObject({ cid: crosspost?.cid })
    const last = (await database.listPdsEvents({ did })).at(-1)!
    expect(decodePdsEvent(last)).toMatchObject({
      type: 'commit',
      repo: did,
      ops: [{ action: 'create', path: `app.bsky.feed.post/${rkey}` }]
    })
    expect(safeRemoteFetch).not.toHaveBeenCalled()
  })

  it('likes a Bluesky post with a like record in the hosted repo', async () => {
    const { actor, did } = await createHosted('hosted-agent-like')
    const { statusId } = await storeBlueskyPost(database, 'hostedlike')
    appView['app.bsky.feed.getPosts'] = () => ({ posts: [{ viewer: {} }] })

    const like = await likeBlueskyPost(database, actor, statusId)

    expect(like.uri).toMatch(
      new RegExp(`^at://${did}/app\\.bsky\\.feed\\.like/`)
    )
    const rkey = like.uri.split('/').at(-1)!
    expect(
      await database.getPdsRecord({
        did,
        collection: 'app.bsky.feed.like',
        rkey
      })
    ).not.toBeNull()
    expect(appViewCalls().map((call) => new URL(call.url).pathname)).toEqual([
      '/xrpc/app.bsky.feed.getPosts'
    ])
  })

  it('follows a Bluesky account with a follow record in the hosted repo', async () => {
    const { actor, did } = await createHosted('hosted-agent-follow')
    const targetDid = 'did:plc:hostedfollowtargetaaaaaa'
    await database.upsertBlueskyActor({
      did: targetDid,
      handle: 'target.bsky.social'
    })
    appView['app.bsky.actor.getProfile'] = () => ({ viewer: {} })

    const follow = await followBlueskyActor(
      database,
      actor,
      blueskyActorId(targetDid)
    )

    const rkey = follow.uri.split('/').at(-1)!
    expect(follow.uri).toBe(`at://${did}/app.bsky.graph.follow/${rkey}`)
    expect(
      await database.getPdsRecord({
        did,
        collection: 'app.bsky.graph.follow',
        rkey
      })
    ).not.toBeNull()
  })

  it('syncs Home from the AppView getTimeline with service auth', async () => {
    const { actor, did } = await createHosted('hosted-agent-sync')
    appView['app.bsky.feed.getTimeline'] = () => ({ feed: [] })
    appView['app.bsky.notification.listNotifications'] = () => ({
      notifications: []
    })

    await syncBlueskyHome(database, actor)

    const timeline = appViewCalls().find((call) =>
      call.url.includes('app.bsky.feed.getTimeline')
    )
    expect(timeline).toBeDefined()
    const authorization = (timeline!.headers as Record<string, string>)
      .Authorization
    expect(
      decodeJwt(authorization.slice('Bearer '.length)).payload
    ).toMatchObject({ iss: did, lxm: 'app.bsky.feed.getTimeline' })
    const account = await database.getBlueskyAccount({ actorId: actor.id })
    expect(account?.syncError).toBeNull()
    expect(account?.lastSyncedAt).not.toBeNull()
  })
})
