import bcrypt from 'bcrypt'
import { NextRequest } from 'next/server'

import { publishActorUpdate } from '@/lib/services/actors/actorUpdate'
import { getQueue } from '@/lib/services/queue'
import { MockActor } from '@/lib/stub/actor'
import { Actor } from '@/lib/types/domain/actor'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { HTTP_STATUS } from '@/lib/utils/response'

import { GET, OPTIONS, POST } from './route'

const PASSWORD = 'correct horse'
const DAY = 24 * 60 * 60 * 1000
const ME = 'https://llun.test/users/llun'

let mockCurrentActor: Actor
let storedActor: Actor
let renameResult: unknown = { ok: false, status: 'not_found' }
let actorHistory: {
  id: string
  actorId: string
  username: string
  domain: string
  createdAt: number
  replacedAt: number | null
}[] = []
let latestReplacedAt: number | null = null

const mockDatabase = {
  getActorFromId: vi.fn(async ({ id }: { id: string }) =>
    id === storedActor.id ? storedActor : null
  ),
  getActorHandles: vi.fn(async ({ actorId }: { actorId: string }) =>
    actorHistory.filter((row) => row.actorId === actorId)
  ),
  getLatestActorHandleReplacedAt: vi.fn(async () => latestReplacedAt),
  getActiveServedDomains: vi.fn(async () => []),
  recordActorHandleRename: vi.fn(async () => renameResult)
}

vi.mock('@/lib/services/actors/actorUpdate', () => ({
  publishActorUpdate: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('@/lib/activities/getActorPerson', () => ({
  getActorPerson: vi.fn()
}))
vi.mock('@/lib/services/federation/getFederationSigningActor', () => ({
  getFederationSigningActorSafe: vi.fn()
}))
vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn()
}))
// The domain pipeline POST /api/v1/actors runs is covered by its own tests;
// here the account filter passes everything and the allowlist names the two
// domains the assertions use.
vi.mock('@/lib/services/serverSettings', () => ({
  getResolvedServerSettings: vi.fn(async () => ({
    federation: { allowActorDomains: ['llun.test', 'new.test'] }
  }))
}))
vi.mock('@/lib/services/domains/signUpDomain', () => ({
  filterActorDomainsForAccount: vi.fn(
    async (
      _database: unknown,
      _accountId: string,
      domains: readonly string[]
    ) => [...domains]
  )
}))
vi.mock('@/lib/services/guards/AuthenticatedGuard', () => ({
  AuthenticatedGuard:
    (
      handle: (
        req: NextRequest,
        context: {
          database: typeof mockDatabase
          currentActor: Actor
          params: Promise<object>
        }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<object> }) =>
      handle(req, {
        database: mockDatabase,
        currentActor: mockCurrentActor,
        params: context?.params ?? Promise.resolve({})
      })
}))

const publish = vi.fn()

const ctx = { params: Promise.resolve({}) }
const post = (body: unknown) =>
  POST(
    new NextRequest('https://llun.test/api/v1/accounts/handle', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
        origin: 'https://llun.test'
      }
    }),
    ctx
  )
const get = (query = '') =>
  GET(
    new NextRequest(`https://llun.test/api/v1/accounts/handle${query}`, {
      method: 'GET',
      headers: { origin: 'https://llun.test' }
    }),
    ctx
  )

const historyRow = (
  username: string,
  replacedAt: number | null,
  createdAt = Date.now()
) => ({
  id: getHashFromString(username),
  actorId: ME,
  username,
  domain: 'llun.test',
  createdAt,
  replacedAt
})

describe('Account handle API route', () => {
  beforeAll(async () => {
    const hash = await bcrypt.hash(PASSWORD, 4)
    mockCurrentActor = Actor.parse({
      ...MockActor({ id: ME }),
      account: {
        id: 'account-1',
        email: 'llun@llun.test',
        passwordHash: hash,
        createdAt: 1,
        updatedAt: 1
      }
    })
  })

  beforeEach(() => {
    vi.clearAllMocks()
    storedActor = Actor.parse({
      ...MockActor({ id: ME }),
      account: {
        id: 'account-1',
        email: 'llun@llun.test',
        passwordHash: null,
        createdAt: 1,
        updatedAt: 1
      }
    })
    actorHistory = []
    latestReplacedAt = null
    renameResult = { ok: false, status: 'not_found' }
    publish.mockReset().mockResolvedValue(undefined)
    vi.mocked(getQueue).mockReturnValue({ publish } as never)
    vi.mocked(publishActorUpdate).mockClear()
  })

  describe('GET', () => {
    it('returns the empty shape for an actor that never renamed', async () => {
      const res = await get()
      expect(res.status).toBe(HTTP_STATUS.OK)
      expect(await res.json()).toEqual({
        actorId: ME,
        username: 'llun',
        domain: 'llun.test',
        acct: 'llun@llun.test',
        history: [],
        cooldownUntil: null,
        domains: ['llun.test', 'new.test']
      })
    })

    it('returns the history and the cooldown of a renamed actor', async () => {
      const replacedAt = Date.now() - 2 * DAY
      storedActor = Actor.parse({
        ...MockActor({ id: ME }),
        username: 'renamed'
      })
      actorHistory = [
        historyRow('renamed', null, replacedAt - DAY),
        historyRow('llun', replacedAt, replacedAt - DAY)
      ]
      latestReplacedAt = replacedAt

      const json = await (await get()).json()
      expect(json.username).toBe('renamed')
      expect(json.acct).toBe('renamed@llun.test')
      expect(json.history).toEqual([
        expect.objectContaining({ username: 'renamed', replacedAt: null }),
        expect.objectContaining({ username: 'llun', replacedAt })
      ])
      expect(json.cooldownUntil).toBe(
        new Date(replacedAt + 30 * DAY).toISOString()
      )
    })

    it('omits an elapsed cooldown', async () => {
      latestReplacedAt = Date.now() - 31 * DAY
      expect((await (await get()).json()).cooldownUntil).toBeNull()
    })

    it('rejects a mismatched actorId with 409', async () => {
      const res = await get('?actorId=https://llun.test/users/other')
      expect(res.status).toBe(HTTP_STATUS.CONFLICT)
      expect(await res.json()).toEqual({ error: 'Actor changed' })
    })

    it('answers 404 when the actor record is gone', async () => {
      mockDatabase.getActorFromId.mockResolvedValueOnce(null)
      const res = await get()
      expect(res.status).toBe(HTTP_STATUS.NOT_FOUND)
    })
  })

  describe('POST guards', () => {
    let savedActor: Actor

    beforeEach(() => {
      savedActor = mockCurrentActor
    })

    afterEach(() => {
      mockCurrentActor = savedActor
    })

    it('refuses the federation signing actor with 403 before anything else', async () => {
      // The headless signer: a Service actor with no account behind it.
      mockCurrentActor = Actor.parse({
        ...MockActor({ id: 'https://llun.test/users/__instance__' }),
        username: '__instance__',
        type: 'Service',
        account: undefined
      })
      const res = await post({ username: 'renamed', password: PASSWORD })
      expect(res.status).toBe(HTTP_STATUS.FORBIDDEN)
      expect(mockDatabase.recordActorHandleRename).not.toHaveBeenCalled()
      expect(publishActorUpdate).not.toHaveBeenCalled()
    })

    it('rejects a malformed body', async () => {
      const res = await post({ username: 42 })
      expect(res.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY)
      expect(await res.json()).toEqual({ error: 'Invalid request' })
    })

    it('rejects a mismatched actorId with 409 before anything else', async () => {
      const res = await post({
        username: 'renamed',
        password: PASSWORD,
        actorId: 'https://llun.test/users/other'
      })
      expect(res.status).toBe(HTTP_STATUS.CONFLICT)
      expect(await res.json()).toEqual({ error: 'Actor changed' })
      expect(mockDatabase.recordActorHandleRename).not.toHaveBeenCalled()
    })

    it.each([
      ['missing', undefined],
      ['wrong', 'nope']
    ])('refuses a %s password', async (_name, password) => {
      const res = await post({ username: 'renamed', password })
      expect(res.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY)
      expect(await res.json()).toEqual({ error: 'Invalid password' })
      expect(mockDatabase.recordActorHandleRename).not.toHaveBeenCalled()
    })

    it('refuses an invalid username', async () => {
      const res = await post({ username: 'bad name!', password: PASSWORD })
      expect(res.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY)
      expect(await res.json()).toEqual({ error: 'Invalid username' })
      expect(mockDatabase.recordActorHandleRename).not.toHaveBeenCalled()
    })

    it('answers 400 for a domain the account is not allowed', async () => {
      const res = await post({
        username: 'renamed',
        domain: 'elsewhere.test',
        password: PASSWORD
      })
      expect(res.status).toBe(HTTP_STATUS.BAD_REQUEST)
      expect(await res.json()).toEqual({ error: 'Domain is not allowed' })
      expect(mockDatabase.recordActorHandleRename).not.toHaveBeenCalled()
    })

    it('answers 404 when the actor record is gone', async () => {
      mockDatabase.getActorFromId.mockResolvedValueOnce(null)
      const res = await post({ username: 'renamed', password: PASSWORD })
      expect(res.status).toBe(HTTP_STATUS.NOT_FOUND)
      expect(await res.json()).toEqual({ error: 'Record not found' })
    })
  })

  describe('POST challenge without a password', () => {
    let savedActor: Actor

    beforeEach(() => {
      savedActor = mockCurrentActor
      mockCurrentActor = Actor.parse({
        ...mockCurrentActor,
        account: { ...mockCurrentActor.account, passwordHash: null }
      })
      renameResult = {
        ok: true,
        previous: { username: 'llun', domain: 'llun.test' },
        current: { username: 'renamed', domain: 'llun.test' },
        handleId: 'handle-1'
      }
    })

    it('requires the CURRENT username, not the new one', async () => {
      const res = await post({ username: 'renamed' })
      expect(res.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY)
      expect(await res.json()).toEqual({ error: 'Invalid username' })
      expect(mockDatabase.recordActorHandleRename).not.toHaveBeenCalled()
    })

    it('accepts the new username once currentUsername confirms', async () => {
      const res = await post({ username: 'renamed', currentUsername: 'llun' })
      expect(res.status).toBe(HTTP_STATUS.OK)
      expect(mockDatabase.recordActorHandleRename).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: ME,
          username: 'renamed',
          domain: 'llun.test',
          cooldownMs: 30 * DAY
        })
      )
    })

    it('confirms the current username case-insensitively', async () => {
      const res = await post({
        username: 'renamed',
        currentUsername: 'LLUN'
      })
      expect(res.status).toBe(HTTP_STATUS.OK)
    })

    afterEach(() => {
      mockCurrentActor = savedActor
    })
  })

  describe('POST result mapping', () => {
    beforeEach(() => {
      renameResult = { ok: false, status: 'unchanged' }
    })

    it('maps unchanged to 422 Nothing to change', async () => {
      renameResult = { ok: false, status: 'unchanged' }
      const res = await post({ username: 'llun', password: PASSWORD })
      expect(res.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY)
      expect(await res.json()).toEqual({ error: 'Nothing to change' })
    })

    it('maps taken to 422 Username already exists', async () => {
      renameResult = { ok: false, status: 'taken' }
      const res = await post({ username: 'other', password: PASSWORD })
      expect(res.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY)
      expect(await res.json()).toEqual({ error: 'Username already exists' })
    })

    it('maps cooldown to 429 with the ISO cooldownUntil', async () => {
      const until = Date.now() + DAY
      renameResult = { ok: false, status: 'cooldown', cooldownUntil: until }
      const res = await post({ username: 'other', password: PASSWORD })
      expect(res.status).toBe(HTTP_STATUS.TOO_MANY_REQUESTS)
      expect(await res.json()).toEqual({
        error: 'Handle was changed recently; please wait before renaming again',
        cooldownUntil: new Date(until).toISOString()
      })
    })

    it('maps moved to 422 with the account-moved message', async () => {
      renameResult = { ok: false, status: 'moved' }
      const res = await post({ username: 'other', password: PASSWORD })
      expect(res.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY)
      expect(await res.json()).toEqual({ error: 'This account has moved' })
    })

    it('maps unavailable to 422', async () => {
      renameResult = { ok: false, status: 'unavailable' }
      const res = await post({ username: 'other', password: PASSWORD })
      expect(res.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY)
    })

    it('maps cannot_rename to 422', async () => {
      renameResult = { ok: false, status: 'cannot_rename' }
      const res = await post({ username: 'other', password: PASSWORD })
      expect(res.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY)
      expect(await res.json()).toEqual({
        error: 'This profile cannot be renamed'
      })
    })

    it('maps not_found to 404', async () => {
      renameResult = { ok: false, status: 'not_found' }
      const res = await post({ username: 'other', password: PASSWORD })
      expect(res.status).toBe(HTTP_STATUS.NOT_FOUND)
    })
  })

  describe('POST success', () => {
    beforeEach(() => {
      renameResult = {
        ok: true,
        previous: { username: 'llun', domain: 'llun.test' },
        current: { username: 'renamed', domain: 'new.test' },
        handleId: 'handle-1'
      }
    })

    it('publishes the update and queues the status URL job with the deterministic id', async () => {
      const res = await post({
        username: 'renamed',
        domain: 'new.test',
        password: PASSWORD
      })
      expect(res.status).toBe(HTTP_STATUS.OK)

      expect(publishActorUpdate).toHaveBeenCalledWith({ actorId: ME })
      expect(publish).toHaveBeenCalledTimes(1)
      expect(publish).toHaveBeenCalledWith({
        id: 'handle-1:statusUrls:start',
        name: 'RenameStatusUrlsJob',
        data: {
          handleId: 'handle-1',
          actorId: ME,
          fromPrefix: 'https://llun.test/@llun/',
          toPrefix: 'https://new.test/@renamed/',
          after: null
        }
      })
    })

    it('returns the GET shape for the new state', async () => {
      storedActor = Actor.parse({
        ...MockActor({ id: ME }),
        username: 'renamed',
        domain: 'new.test',
        account: {
          id: 'account-1',
          email: 'llun@llun.test',
          passwordHash: null,
          createdAt: 1,
          updatedAt: 1
        }
      })
      const res = await post({
        username: 'renamed',
        domain: 'new.test',
        password: PASSWORD
      })
      const json = await res.json()
      expect(json.actorId).toBe(ME)
      expect(json.username).toBe('renamed')
      expect(json.domain).toBe('new.test')
      expect(json.acct).toBe('renamed@new.test')
      expect(json.cooldownUntil).toBeNull()
    })

    it('still answers 200 when the status URL job cannot be queued', async () => {
      publish.mockRejectedValueOnce(new Error('queue down'))
      const res = await post({ username: 'renamed', password: PASSWORD })
      expect(res.status).toBe(HTTP_STATUS.OK)
      expect(publishActorUpdate).toHaveBeenCalledWith({ actorId: ME })
    })
  })

  it('answers OPTIONS', async () => {
    const res = await OPTIONS(
      new NextRequest('https://llun.test/api/v1/accounts/handle', {
        method: 'OPTIONS',
        headers: { origin: 'https://llun.test' }
      })
    )
    expect(res.status).toBe(HTTP_STATUS.OK)
  })
})
