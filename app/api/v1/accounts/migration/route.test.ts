import bcrypt from 'bcrypt'
import { NextRequest } from 'next/server'

import { getActorPerson } from '@/lib/activities/getActorPerson'
import {
  PUBLISH_SCHEDULED_STATUS_JOB_NAME,
  SEND_MOVE_JOB_NAME
} from '@/lib/jobs/names'
import { publishActorUpdate } from '@/lib/services/actors/actorUpdate'
import { resolveAccountTarget } from '@/lib/services/actors/resolveAccountTarget'
import { getFederationSigningActorSafe } from '@/lib/services/federation/getFederationSigningActor'
import { getQueue } from '@/lib/services/queue'
import { MockActor } from '@/lib/stub/actor'
import { Actor } from '@/lib/types/domain/actor'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { HTTP_STATUS } from '@/lib/utils/response'

import { DELETE, GET, OPTIONS, POST } from './route'

const PASSWORD = 'correct horse'
const DAY = 24 * 60 * 60 * 1000

let mockCurrentActor: Actor
let storedActor: Actor
let storedTarget: Actor | null = null
const migrations: {
  id: string
  actorId: string
  targetActorId: string
  targetAcct: string
  kind: 'move' | 'redirect'
  followersCount: number
  createdAt: number
  startedAt?: number | null
}[] = []
const scheduledStatuses: {
  id: string
  actorId: string
  scheduledAt: number
}[] = []
let suspended = new Set<string>()
let recordOutcome:
  | { status: 'created' }
  | { status: 'existing' }
  | { status: 'cooldown'; until: number }
  | { status: 'no-actor' } = { status: 'created' }

const mockDatabase = {
  getActorFromId: vi.fn(async ({ id }: { id: string }) =>
    id === storedActor.id
      ? storedActor
      : id === storedTarget?.id
        ? storedTarget
        : null
  ),
  updateActor: vi.fn(
    async ({ movedTo }: { actorId: string; movedTo?: string | null }) => {
      storedActor = { ...storedActor, movedTo: movedTo ?? undefined }
      return storedActor
    }
  ),
  getModerationStatesForActors: vi.fn(
    async ({ actorIds }: { actorIds: string[] }) =>
      new Map(
        actorIds
          .filter((id) => suspended.has(id))
          .map((id) => [
            id,
            { suspendedAt: 1, silencedAt: null, sensitizedAt: null }
          ])
      )
  ),
  getActorFollowersCount: vi.fn(async () => 42),
  getScheduledStatuses: vi.fn(
    async ({
      actorId,
      limit,
      maxId
    }: {
      actorId: string
      limit: number
      maxId?: string
    }) => {
      const rows = scheduledStatuses
        .filter((row) => row.actorId === actorId)
        .sort(
          (a, b) => b.scheduledAt - a.scheduledAt || b.id.localeCompare(a.id)
        )
      const cursor = maxId ? rows.findIndex((row) => row.id === maxId) : -1
      if (maxId && cursor < 0) return []
      return rows.slice(cursor + 1, cursor + 1 + limit)
    }
  ),
  // The retry and cooldown rule lives in recordActorMigration and is covered
  // by actorMigration.test.ts and outgoingMove.test.ts against real databases;
  // each route test here sets the outcome it needs.
  recordActorMigration: vi.fn(
    async ({
      cooldownMs: _cooldownMs,
      aliasVerified: _aliasVerified,
      ...params
    }: Omit<(typeof migrations)[number], 'createdAt'> & {
      cooldownMs: number
      aliasVerified: boolean
    }) => {
      if (recordOutcome.status === 'existing') {
        return { status: 'existing' as const, migration: migrations[0] }
      }
      if (recordOutcome.status !== 'created') return recordOutcome
      const migration = { ...params, createdAt: Date.now() }
      migrations.unshift(migration)
      storedActor = { ...storedActor, movedTo: params.targetActorId }
      return { status: 'created' as const, migration }
    }
  ),
  markActorMigrationStarted: vi.fn(async ({ id }: { id: string }) => {
    const row = migrations.find((m) => m.id === id)
    if (row && !row.startedAt) row.startedAt = Date.now()
  }),
  getActorMigrations: vi.fn(async () =>
    migrations.map((m) => ({ ...m, startedAt: m.startedAt ?? null }))
  ),
  getLastActorMove: vi.fn(async () => {
    const last = migrations.find((m) => m.kind === 'move')
    return last ? { ...last, startedAt: last.startedAt ?? null } : null
  })
}

vi.mock('@/lib/services/actors/actorUpdate', () => ({
  publishActorUpdate: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('@/lib/services/actors/resolveAccountTarget', () => ({
  resolveAccountTarget: vi.fn()
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

const ME = 'https://llun.test/users/llun'
const publish = vi.fn()

const ctx = { params: Promise.resolve({}) }
const post = (body: unknown) =>
  POST(
    new NextRequest('https://llun.test/api/v1/accounts/migration', {
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
    new NextRequest(`https://llun.test/api/v1/accounts/migration${query}`, {
      method: 'GET',
      headers: { origin: 'https://llun.test' }
    }),
    ctx
  )
const del = (query = '', body?: unknown) =>
  DELETE(
    new NextRequest(`https://llun.test/api/v1/accounts/migration${query}`, {
      method: 'DELETE',
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { origin: 'https://llun.test' }
    }),
    ctx
  )

const makeTarget = (overrides: Partial<Actor> = {}) => {
  const target = MockActor({ id: 'https://new.test/users/llun' })
  // A remote actor row has no private key.
  return Actor.parse({ ...target, privateKey: '', ...overrides })
}

const resolveTo = (target: Actor) =>
  vi
    .mocked(resolveAccountTarget)
    .mockResolvedValue({ type: 'resolved', actor: target })
const remoteDocument = (doc: Record<string, unknown>) =>
  vi
    .mocked(getActorPerson)
    .mockResolvedValue({ id: 'https://new.test/users/llun', ...doc } as never)

const goodBody = {
  acct: '@llun@new.test',
  kind: 'move' as const,
  password: PASSWORD
}

describe('Account migration API route', () => {
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
    migrations.length = 0
    scheduledStatuses.length = 0
    suspended = new Set()
    recordOutcome = { status: 'created' }
    storedActor = MockActor({ id: ME })
    storedTarget = null
    publish.mockReset().mockResolvedValue(undefined)
    vi.mocked(getQueue).mockReturnValue({ publish } as never)
    resolveTo(makeTarget())
    remoteDocument({ alsoKnownAs: [ME] })
    vi.mocked(getFederationSigningActorSafe).mockResolvedValue({
      id: 'https://llun.test/users/signer'
    } as Actor)
  })

  describe('GET', () => {
    it('returns the empty shape', async () => {
      const res = await get()
      expect(res.status).toBe(HTTP_STATUS.OK)
      expect(await res.json()).toEqual({
        movedTo: null,
        migrations: [],
        cooldownUntil: null,
        followersCount: 42
      })
    })

    it('returns movedTo, history and the cooldown while it lasts', async () => {
      const createdAt = Date.now() - 2 * DAY
      migrations.push({
        id: 'm1',
        actorId: ME,
        targetActorId: 'https://new.test/users/llun',
        targetAcct: 'llun@new.test',
        kind: 'move',
        followersCount: 5,
        createdAt
      })
      storedActor = { ...storedActor, movedTo: 'https://new.test/users/llun' }
      storedTarget = makeTarget()

      const json = await (await get()).json()
      expect(json.movedTo).toEqual({
        id: 'https://new.test/users/llun',
        acct: 'llun@new.test'
      })
      expect(json.migrations).toEqual([
        {
          targetActorId: 'https://new.test/users/llun',
          acct: 'llun@new.test',
          kind: 'move',
          createdAt: new Date(createdAt).toISOString()
        }
      ])
      expect(json.cooldownUntil).toBe(
        new Date(createdAt + 30 * DAY).toISOString()
      )
    })

    it('omits an elapsed cooldown', async () => {
      migrations.push({
        id: 'm1',
        actorId: ME,
        targetActorId: 'https://new.test/users/llun',
        targetAcct: 'llun@new.test',
        kind: 'move',
        followersCount: 5,
        createdAt: Date.now() - 31 * DAY
      })
      expect((await (await get()).json()).cooldownUntil).toBeNull()
    })

    it('rejects a mismatched actorId with 409', async () => {
      const res = await get('?actorId=https://llun.test/users/other')
      expect(res.status).toBe(HTTP_STATUS.CONFLICT)
      expect(await res.json()).toEqual({ error: 'Actor changed' })
    })
  })

  describe('POST challenge', () => {
    it.each([
      ['missing', undefined],
      ['wrong', 'nope']
    ])('refuses a %s password', async (_name, password) => {
      const res = await post({ ...goodBody, password })
      expect(res.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY)
      expect(await res.json()).toEqual({ error: 'Invalid password' })
      expect(mockDatabase.recordActorMigration).not.toHaveBeenCalled()
    })

    it('accepts the right password', async () => {
      expect((await post(goodBody)).status).toBe(HTTP_STATUS.OK)
    })

    describe('account without a password', () => {
      beforeEach(() => {
        mockCurrentActor = Actor.parse({
          ...mockCurrentActor,
          account: { ...mockCurrentActor.account, passwordHash: null }
        })
      })
      afterEach(async () => {
        const hash = await bcrypt.hash(PASSWORD, 4)
        mockCurrentActor = Actor.parse({
          ...mockCurrentActor,
          account: { ...mockCurrentActor.account, passwordHash: hash }
        })
      })

      it('requires the current username', async () => {
        const res = await post({ ...goodBody, password: undefined })
        expect(res.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY)
        expect(await res.json()).toEqual({ error: 'Invalid username' })
      })

      it('accepts the username, case-insensitively', async () => {
        const res = await post({
          ...goodBody,
          password: undefined,
          username: 'LLUN'
        })
        expect(res.status).toBe(HTTP_STATUS.OK)
      })
    })
  })

  describe('POST validation', () => {
    it('rejects a mismatched actorId with 409 before anything else', async () => {
      const res = await post({
        ...goodBody,
        actorId: 'https://llun.test/users/other'
      })
      expect(res.status).toBe(HTTP_STATUS.CONFLICT)
      expect(await res.json()).toEqual({ error: 'Actor changed' })
      expect(resolveAccountTarget).not.toHaveBeenCalled()
    })

    it('rejects a malformed body', async () => {
      const res = await post({ acct: 'x', kind: 'nope', password: PASSWORD })
      expect(res.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY)
    })

    it('trims and strips one leading @ before resolving', async () => {
      await post({ ...goodBody, acct: '  @llun@new.test ' })
      expect(resolveAccountTarget).toHaveBeenCalledWith(
        expect.objectContaining({ input: 'llun@new.test' })
      )
    })

    it.each([
      ['invalid', 422],
      ['forbidden', 403],
      ['not-found', 404]
    ] as const)('maps a %s target to %i', async (type, status) => {
      vi.mocked(resolveAccountTarget).mockResolvedValue({ type })
      expect((await post(goodBody)).status).toBe(status)
    })

    it('names the refused domain in its 403 body', async () => {
      vi.mocked(resolveAccountTarget).mockResolvedValue({ type: 'forbidden' })
      const res = await post(goodBody)
      expect(res.status).toBe(HTTP_STATUS.FORBIDDEN)
      expect(await res.json()).toEqual({
        error: 'Federation with that server is not allowed'
      })
    })

    it('refuses moving to yourself', async () => {
      resolveTo(MockActor({ id: ME }))
      const res = await post(goodBody)
      expect(res.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY)
      expect(await res.json()).toEqual({ error: 'Cannot move to yourself' })
    })

    it('refuses a suspended target', async () => {
      suspended.add('https://new.test/users/llun')
      const res = await post(goodBody)
      expect(await res.json()).toEqual({
        error: 'Target account is not available'
      })
      expect(res.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY)
    })

    it('refuses a deleted target', async () => {
      resolveTo(makeTarget({ deletionStatus: 'scheduled' } as never))
      const res = await post(goodBody)
      expect(await res.json()).toEqual({
        error: 'Target account is not available'
      })
    })

    it('refuses a target that has moved (cached row)', async () => {
      resolveTo(makeTarget({ movedTo: 'https://third.test/users/llun' }))
      const res = await post({ ...goodBody, kind: 'redirect' })
      expect(await res.json()).toEqual({ error: 'Target account has moved' })
    })

    it('refuses a target whose fresh document says it has moved', async () => {
      remoteDocument({
        alsoKnownAs: [ME],
        movedTo: 'https://third.test/users/llun'
      })
      const res = await post(goodBody)
      expect(await res.json()).toEqual({ error: 'Target account has moved' })
    })

    it('refuses a target already moved to', async () => {
      storedActor = { ...storedActor, movedTo: 'https://new.test/users/llun' }
      const res = await post({ ...goodBody, kind: 'redirect' })
      expect(res.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY)
      expect(await res.json()).toEqual({
        error: 'Already moved to this account'
      })
    })
  })

  describe('POST move', () => {
    it('requires the alias on a remote target, read fresh', async () => {
      resolveTo(makeTarget({ alsoKnownAs: [ME] })) // stale cache says yes
      remoteDocument({ alsoKnownAs: [] }) // the live document says no
      const res = await post(goodBody)
      expect(res.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY)
      expect(await res.json()).toEqual({
        error: 'Add this account as an alias on the new account first'
      })
      expect(getActorPerson).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 'https://new.test/users/llun' })
      )
      expect(mockDatabase.recordActorMigration).not.toHaveBeenCalled()
    })

    it('answers 502 when the new account cannot be reached', async () => {
      vi.mocked(getActorPerson).mockResolvedValue(null)
      const res = await post(goodBody)
      expect(res.status).toBe(HTTP_STATUS.BAD_GATEWAY)
      expect(await res.json()).toEqual({
        error: 'Could not reach the new account, try again later'
      })
      expect(mockDatabase.recordActorMigration).not.toHaveBeenCalled()
    })

    it('answers 500, not 502, when there is no signing actor to fetch with', async () => {
      vi.mocked(getFederationSigningActorSafe).mockResolvedValue(undefined)
      const res = await post(goodBody)
      expect(res.status).toBe(HTTP_STATUS.INTERNAL_SERVER_ERROR)
      expect(await res.json()).toEqual({
        error: 'This server cannot fetch remote accounts right now'
      })
      expect(getActorPerson).not.toHaveBeenCalled()
      expect(mockDatabase.recordActorMigration).not.toHaveBeenCalled()
    })

    it('reads a local target from its row, without a fetch', async () => {
      const local = MockActor({ id: 'https://other.test/users/llun' })
      resolveTo(Actor.parse({ ...local, alsoKnownAs: [ME] }))
      expect((await post(goodBody)).status).toBe(HTTP_STATUS.OK)
      expect(getActorPerson).not.toHaveBeenCalled()
    })

    it('refuses a local target without the alias', async () => {
      resolveTo(MockActor({ id: 'https://other.test/users/llun' }))
      const res = await post(goodBody)
      expect(await res.json()).toEqual({
        error: 'Add this account as an alias on the new account first'
      })
    })

    it('applies the move: movedTo, update, row and SendMoveJob', async () => {
      const res = await post(goodBody)
      expect(res.status).toBe(HTTP_STATUS.OK)

      expect(storedActor.movedTo).toBe('https://new.test/users/llun')
      expect(mockDatabase.updateActor).not.toHaveBeenCalled()
      expect(publishActorUpdate).toHaveBeenCalledWith({ actorId: ME })
      expect(mockDatabase.recordActorMigration).toHaveBeenCalledWith(
        expect.objectContaining({
          cooldownMs: 30 * DAY,
          actorId: ME,
          targetActorId: 'https://new.test/users/llun',
          targetAcct: 'llun@new.test',
          kind: 'move',
          followersCount: 42
        })
      )
      const migrationId = mockDatabase.recordActorMigration.mock.calls[0][0].id
      expect(mockDatabase.markActorMigrationStarted).toHaveBeenCalledWith({
        id: migrationId
      })
      expect(publish).toHaveBeenCalledTimes(1)
      expect(publish).toHaveBeenCalledWith({
        id: `${migrationId}:start`,
        name: SEND_MOVE_JOB_NAME,
        data: {
          migrationId,
          originActorId: ME,
          targetActorId: 'https://new.test/users/llun'
        }
      })

      const json = await res.json()
      expect(json.movedTo.id).toBe('https://new.test/users/llun')
      expect(json.migrations).toHaveLength(1)
      expect(json.cooldownUntil).not.toBeNull()
    })

    it('answers 503 when the job cannot be queued, and a retry completes the move', async () => {
      publish.mockRejectedValueOnce(new Error('queue down'))
      const res = await post(goodBody)
      expect(res.status).toBe(HTTP_STATUS.SERVICE_UNAVAILABLE)
      expect(await res.json()).toEqual({
        error: 'Could not start the move, try again later'
      })
      expect(storedActor.movedTo).toBe('https://new.test/users/llun')
      expect(migrations).toHaveLength(1)
      const migrationId = migrations[0].id
      expect(mockDatabase.markActorMigrationStarted).not.toHaveBeenCalled()

      recordOutcome = { status: 'existing' }
      const retry = await post(goodBody)
      expect(retry.status).toBe(HTTP_STATUS.OK)
      expect(mockDatabase.markActorMigrationStarted).toHaveBeenCalledWith({
        id: migrationId
      })
      expect(migrations).toHaveLength(1)
      expect(publish).toHaveBeenCalledTimes(2)
      expect(publish.mock.calls[1][0]).toMatchObject({
        id: `${migrationId}:start`,
        data: { migrationId }
      })
      expect(publish.mock.calls[0][0].id).toBe(`${migrationId}:start`)
    })

    it('does not let a retry of a move to the first target bypass the cooldown for another', async () => {
      await post(goodBody)
      resolveTo(makeTarget({ id: 'https://third.test/users/llun' }))
      mockDatabase.recordActorMigration.mockClear()
      const res = await post({ ...goodBody, acct: '@llun@third.test' })
      expect(res.status).toBe(HTTP_STATUS.TOO_MANY_REQUESTS)
      // Answered from the last move row, before the target or the database.
      expect(mockDatabase.recordActorMigration).not.toHaveBeenCalled()
      expect(migrations).toHaveLength(1)
    })

    it('keeps the cooldown after the redirect was deleted', async () => {
      expect((await post(goodBody)).status).toBe(HTTP_STATUS.OK)
      expect((await del()).status).toBe(HTTP_STATUS.OK)
      expect(storedActor.movedTo).toBeUndefined()
      recordOutcome = { status: 'cooldown', until: Date.now() + 30 * DAY }
      const res = await post(goodBody)
      expect(res.status).toBe(HTTP_STATUS.TOO_MANY_REQUESTS)
      expect(migrations).toHaveLength(1)
    })

    it('answers 422 to a repeat of a successful move and queues nothing', async () => {
      expect((await post(goodBody)).status).toBe(HTTP_STATUS.OK)
      publish.mockClear()
      vi.mocked(publishActorUpdate).mockClear()
      const res = await post(goodBody)
      expect(res.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY)
      expect(await res.json()).toEqual({
        error: 'Already moved to this account'
      })
      expect(publish).not.toHaveBeenCalled()
      expect(publishActorUpdate).not.toHaveBeenCalled()
    })

    it('answers 429 to a move after a cancelled, unstarted move was redirected to the same account', async () => {
      publish.mockRejectedValueOnce(new Error('queue down'))
      expect((await post(goodBody)).status).toBe(
        HTTP_STATUS.SERVICE_UNAVAILABLE
      )
      expect((await del()).status).toBe(HTTP_STATUS.OK)
      expect((await post({ ...goodBody, kind: 'redirect' })).status).toBe(
        HTTP_STATUS.OK
      )
      publish.mockClear()
      vi.mocked(publishActorUpdate).mockClear()

      recordOutcome = { status: 'cooldown', until: Date.now() + 30 * DAY }
      const res = await post(goodBody)
      expect(res.status).toBe(HTTP_STATUS.TOO_MANY_REQUESTS)
      expect(publish).not.toHaveBeenCalled()
      expect(publishActorUpdate).not.toHaveBeenCalled()
    })

    it('answers 404 when the actor record is gone', async () => {
      recordOutcome = { status: 'no-actor' }
      const res = await post(goodBody)
      expect(res.status).toBe(HTTP_STATUS.NOT_FOUND)
      expect(await res.json()).toEqual({ error: 'Record not found' })
      expect(publish).not.toHaveBeenCalled()
    })

    it('refuses with 429 and the date inside the 30-day cooldown', async () => {
      const lastMove = Date.now() - 3 * DAY
      migrations.push({
        id: 'old',
        actorId: ME,
        targetActorId: 'https://old.test/users/llun',
        targetAcct: 'llun@old.test',
        kind: 'move',
        followersCount: 1,
        createdAt: lastMove
      })
      const until = new Date(lastMove + 30 * DAY).toISOString()
      recordOutcome = { status: 'cooldown', until: lastMove + 30 * DAY }
      const res = await post(goodBody)
      expect(res.status).toBe(HTTP_STATUS.TOO_MANY_REQUESTS)
      expect(await res.json()).toEqual({
        error: `You can move again after ${until}`,
        cooldownUntil: until
      })
      expect(publish).not.toHaveBeenCalled()
    })

    it('allows a move once the cooldown has elapsed', async () => {
      migrations.push({
        id: 'old',
        actorId: ME,
        targetActorId: 'https://old.test/users/llun',
        targetAcct: 'llun@old.test',
        kind: 'move',
        followersCount: 1,
        createdAt: Date.now() - 31 * DAY
      })
      expect((await post(goodBody)).status).toBe(HTTP_STATUS.OK)
    })
  })

  describe('POST redirect', () => {
    it('needs no alias and no fetch, and publishes no SendMoveJob', async () => {
      remoteDocument({ alsoKnownAs: [] })
      const res = await post({ ...goodBody, kind: 'redirect' })
      expect(res.status).toBe(HTTP_STATUS.OK)
      expect(getActorPerson).not.toHaveBeenCalled()
      expect(storedActor.movedTo).toBe('https://new.test/users/llun')
      expect(publishActorUpdate).toHaveBeenCalledWith({ actorId: ME })
      expect(mockDatabase.recordActorMigration).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'redirect' })
      )
      expect(publish).not.toHaveBeenCalled()
      expect((await res.json()).cooldownUntil).toBeNull()
    })

    it('is allowed during a move cooldown', async () => {
      migrations.push({
        id: 'old',
        actorId: ME,
        targetActorId: 'https://old.test/users/llun',
        targetAcct: 'llun@old.test',
        kind: 'move',
        followersCount: 1,
        createdAt: Date.now() - DAY
      })
      const res = await post({ ...goodBody, kind: 'redirect' })
      expect(res.status).toBe(HTTP_STATUS.OK)
    })
  })

  describe('DELETE', () => {
    it('clears movedTo and federates the update', async () => {
      storedActor = { ...storedActor, movedTo: 'https://new.test/users/llun' }
      const res = await del()
      expect(res.status).toBe(HTTP_STATUS.OK)
      expect(mockDatabase.updateActor).toHaveBeenCalledWith({
        actorId: ME,
        movedTo: null
      })
      expect(publishActorUpdate).toHaveBeenCalledWith({ actorId: ME })
      expect((await res.json()).movedTo).toBeNull()
      expect(publish).not.toHaveBeenCalled()
    })

    it('keeps an already-cleared redirect unchanged when no statuses are due', async () => {
      const res = await del()
      expect(res.status).toBe(HTTP_STATUS.OK)
      expect(mockDatabase.updateActor).not.toHaveBeenCalled()
      expect(publishActorUpdate).not.toHaveBeenCalled()
      expect(publish).not.toHaveBeenCalled()
    })

    it('does not replay due statuses for an account that never moved', async () => {
      scheduledStatuses.push({
        id: 'due',
        actorId: ME,
        scheduledAt: Date.now() - 1_000
      })

      expect((await del()).status).toBe(HTTP_STATUS.OK)
      expect(mockDatabase.getScheduledStatuses).not.toHaveBeenCalled()
      expect(publish).not.toHaveBeenCalled()
    })

    it('does not replay an already-cleared account with migration history', async () => {
      migrations.push({
        id: 'old-migration',
        actorId: ME,
        targetActorId: 'https://old.test/users/llun',
        targetAcct: 'llun@old.test',
        kind: 'redirect',
        followersCount: 0,
        createdAt: Date.now() - DAY
      })
      scheduledStatuses.push({
        id: 'due',
        actorId: ME,
        scheduledAt: Date.now() - 1_000
      })

      expect((await del()).status).toBe(HTTP_STATUS.OK)
      expect(mockDatabase.getScheduledStatuses).not.toHaveBeenCalled()
      expect(publish).not.toHaveBeenCalled()
    })

    it('reads the previous migration before clearing the redirect', async () => {
      storedActor = { ...storedActor, movedTo: 'https://new.test/users/llun' }
      const scheduledAt = Date.now() - 1_000
      scheduledStatuses.push({ id: 'due', actorId: ME, scheduledAt })
      // A redirect landing right after the clear would be the newer row a
      // late read would see; the replay must use the row read BEFORE clearing.
      migrations.push({
        id: 'newer-redirect',
        actorId: ME,
        targetActorId: 'https://newer.test/users/llun',
        targetAcct: 'llun@newer.test',
        kind: 'redirect',
        followersCount: 0,
        createdAt: Date.now() - DAY
      })
      mockDatabase.getActorMigrations.mockImplementationOnce(async () => [
        {
          id: 'pre-clear-migration',
          actorId: ME,
          targetActorId: 'https://old.test/users/llun',
          targetAcct: 'llun@old.test',
          kind: 'redirect' as const,
          followersCount: 0,
          createdAt: Date.now() - DAY,
          startedAt: null
        }
      ])

      expect((await del()).status).toBe(HTTP_STATUS.OK)
      expect(
        mockDatabase.getActorMigrations.mock.invocationCallOrder[0]
      ).toBeLessThan(mockDatabase.updateActor.mock.invocationCallOrder[0])
      expect(publish).toHaveBeenCalledWith({
        id: getHashFromString(
          `due-${scheduledAt}:redirect-cleared:pre-clear-migration`
        ),
        name: PUBLISH_SCHEDULED_STATUS_JOB_NAME,
        data: { scheduledStatusId: 'due', scheduledAt }
      })
    })

    it('skips replay if another redirect is set during the due-status scan', async () => {
      storedActor = { ...storedActor, movedTo: 'https://old.test/users/llun' }
      migrations.push({
        id: 'old-migration',
        actorId: ME,
        targetActorId: 'https://old.test/users/llun',
        targetAcct: 'llun@old.test',
        kind: 'redirect',
        followersCount: 0,
        createdAt: Date.now() - DAY
      })
      scheduledStatuses.push({
        id: 'due',
        actorId: ME,
        scheduledAt: Date.now() - 1_000
      })
      mockDatabase.getScheduledStatuses.mockImplementationOnce(async () => {
        storedActor = { ...storedActor, movedTo: 'https://new.test/users/llun' }
        return scheduledStatuses
      })

      const res = await del()
      expect(res.status).toBe(HTTP_STATUS.OK)
      expect((await res.json()).movedTo).toEqual({
        id: 'https://new.test/users/llun',
        acct: null
      })
      expect(mockDatabase.getScheduledStatuses).toHaveBeenCalledOnce()
      expect(publish).not.toHaveBeenCalled()
    })

    it('requeues every due status for the actor and skips future and other-actor statuses', async () => {
      const now = Date.now()
      storedActor = { ...storedActor, movedTo: 'https://new.test/users/llun' }
      scheduledStatuses.push(
        ...Array.from({ length: 101 }, (_, index) => ({
          id: `future-${index}`,
          actorId: ME,
          scheduledAt: now + 60_000 + index
        })),
        { id: 'due-one', actorId: ME, scheduledAt: now - 2_000 },
        { id: 'due-two', actorId: ME, scheduledAt: now - 1_000 },
        {
          id: 'other-due',
          actorId: 'https://llun.test/users/other',
          scheduledAt: now - 3_000
        }
      )

      const res = await del()

      expect(res.status).toBe(HTTP_STATUS.OK)
      expect(mockDatabase.getScheduledStatuses).toHaveBeenCalledTimes(2)
      expect(mockDatabase.getScheduledStatuses).toHaveBeenCalledWith({
        actorId: ME,
        limit: 100,
        maxId: undefined
      })
      expect(publish).toHaveBeenCalledTimes(2)
      expect(publish.mock.calls[0][0].id).not.toBe(
        getHashFromString(`due-two-${now - 1_000}`)
      )
      expect(publish.mock.calls.map(([message]) => message)).toEqual([
        {
          id: getHashFromString(
            `due-two-${now - 1_000}:redirect-cleared:legacy`
          ),
          name: PUBLISH_SCHEDULED_STATUS_JOB_NAME,
          data: { scheduledStatusId: 'due-two', scheduledAt: now - 1_000 }
        },
        {
          id: getHashFromString(
            `due-one-${now - 2_000}:redirect-cleared:legacy`
          ),
          name: PUBLISH_SCHEDULED_STATUS_JOB_NAME,
          data: { scheduledStatusId: 'due-one', scheduledAt: now - 2_000 }
        }
      ])
    })

    it('does not replay again after a partial queue failure cleared the redirect', async () => {
      const now = Date.now()
      await post({ ...goodBody, kind: 'redirect' })
      scheduledStatuses.push(
        { id: 'due-one', actorId: ME, scheduledAt: now - 1_000 },
        { id: 'due-two', actorId: ME, scheduledAt: now - 2_000 },
        { id: 'due-three', actorId: ME, scheduledAt: now - 3_000 }
      )
      publish.mockImplementation(async (message) => {
        if (message.data.scheduledStatusId === 'due-two') {
          throw new Error('queue down')
        }
      })

      await expect(del()).rejects.toThrow('queue down')
      expect(storedActor.movedTo).toBeUndefined()
      expect(publish).toHaveBeenCalledTimes(2)
      expect((await del()).status).toBe(HTTP_STATUS.OK)
      expect(publish).toHaveBeenCalledTimes(2)
      expect(mockDatabase.getScheduledStatuses).toHaveBeenCalledTimes(1)
      expect(mockDatabase.updateActor).toHaveBeenCalledTimes(1)
    })

    it('uses a fresh replay id after another redirect even for the same scheduled row', async () => {
      scheduledStatuses.push({
        id: 'due',
        actorId: ME,
        scheduledAt: Date.now() - 1_000
      })
      await post({ ...goodBody, kind: 'redirect' })
      await del()
      const firstId = publish.mock.calls[0][0].id
      await post({ ...goodBody, kind: 'redirect' })
      await del()
      expect(publish).toHaveBeenCalledTimes(2)
      expect(publish.mock.calls[1][0].id).not.toBe(firstId)
    })

    it('snapshots every page before inline publishing deletes the cursor rows', async () => {
      const now = Date.now()
      storedActor = { ...storedActor, movedTo: 'https://new.test/users/llun' }
      const due = Array.from({ length: 101 }, (_, index) => ({
        id: `due-${index}`,
        actorId: ME,
        scheduledAt: now - 1_000 - index
      }))
      scheduledStatuses.push(
        ...due,
        { id: 'future', actorId: ME, scheduledAt: now + DAY },
        { id: 'other-due', actorId: 'other', scheduledAt: now - 1_000 }
      )
      publish.mockImplementation(async (message) => {
        const index = scheduledStatuses.findIndex(
          (row) => row.id === message.data.scheduledStatusId
        )
        expect(index).toBeGreaterThanOrEqual(0)
        scheduledStatuses.splice(index, 1)
      })

      expect((await del()).status).toBe(HTTP_STATUS.OK)
      expect(
        publish.mock.calls.map(([message]) => message.data.scheduledStatusId)
      ).toEqual(due.map((row) => row.id))
      expect(scheduledStatuses.map((row) => row.id)).toEqual([
        'future',
        'other-due'
      ])
      expect(mockDatabase.getScheduledStatuses).toHaveBeenCalledTimes(2)
    })

    it('keeps the move history', async () => {
      storedActor = { ...storedActor, movedTo: 'https://new.test/users/llun' }
      migrations.push({
        id: 'old',
        actorId: ME,
        targetActorId: 'https://new.test/users/llun',
        targetAcct: 'llun@new.test',
        kind: 'move',
        followersCount: 1,
        createdAt: Date.now() - DAY
      })
      const json = await (await del()).json()
      expect(json.migrations).toHaveLength(1)
      expect(json.cooldownUntil).not.toBeNull()
    })

    it('rejects a mismatched actorId (query or body) with 409', async () => {
      storedActor = { ...storedActor, movedTo: 'https://new.test/users/llun' }
      const other = 'https://llun.test/users/other'
      expect((await del(`?actorId=${other}`)).status).toBe(HTTP_STATUS.CONFLICT)
      expect((await del('', { actorId: other })).status).toBe(
        HTTP_STATUS.CONFLICT
      )
      expect(mockDatabase.updateActor).not.toHaveBeenCalled()
      expect(mockDatabase.getScheduledStatuses).not.toHaveBeenCalled()
      expect(publish).not.toHaveBeenCalled()
    })
  })

  it('answers OPTIONS', async () => {
    const res = await OPTIONS(
      new NextRequest('https://llun.test/api/v1/accounts/migration', {
        method: 'OPTIONS',
        headers: { origin: 'https://llun.test' }
      })
    )
    expect(res.status).toBe(HTTP_STATUS.OK)
  })
})
