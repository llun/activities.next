import { NextRequest } from 'next/server'

import { publishActorUpdate } from '@/lib/services/actors/actorUpdate'
import { resolveAccountTarget } from '@/lib/services/actors/resolveAccountTarget'
import { MockActor } from '@/lib/stub/actor'
import { Actor } from '@/lib/types/domain/actor'
import { actorIdsMatch } from '@/lib/utils/activitypub'
import { HTTP_STATUS } from '@/lib/utils/response'

import { DELETE, GET, OPTIONS, POST } from './route'

const mockCurrentActor: Actor = MockActor({
  id: 'https://llun.test/users/llun'
})

let mockStoredActor: Actor
const actorRegistry = new Map<string, Actor>()

const mockDatabase = {
  getActorFromId: vi.fn(async ({ id }: { id: string }) => {
    return actorRegistry.get(id) ?? null
  }),
  updateActor: vi.fn(
    async ({
      actorId,
      alsoKnownAs
    }: {
      actorId: string
      alsoKnownAs?: string[]
    }) => {
      const actor = actorRegistry.get(actorId)
      if (actor) {
        actor.alsoKnownAs = alsoKnownAs
        return actor
      }
      return null
    }
  ),
  updateActorAliases: vi.fn(
    async ({
      actorId,
      add,
      remove,
      max
    }: {
      actorId: string
      add?: string
      remove?: string
      max: number
    }) => {
      const actor = actorRegistry.get(actorId)
      if (!actor) return { status: 'no-actor' as const }
      const current = actor.alsoKnownAs ?? []
      let next = [...current]
      if (remove !== undefined) {
        const exists = next.some((alias) => actorIdsMatch(alias, remove))
        if (!exists) return { status: 'not-found' as const }
        next = next.filter((alias) => !actorIdsMatch(alias, remove))
      }
      if (add !== undefined) {
        const duplicate = next.some((alias) => actorIdsMatch(alias, add))
        if (duplicate) return { status: 'duplicate' as const }
        if (next.length >= max) return { status: 'limit' as const }
        next = [...next, add]
      }
      actor.alsoKnownAs = next
      return { status: 'ok' as const, aliases: next }
    }
  )
}

vi.mock('@/lib/services/actors/actorUpdate', () => ({
  publishActorUpdate: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/lib/services/actors/resolveAccountTarget', () => ({
  resolveAccountTarget: vi.fn()
}))

vi.mock('@/lib/services/guards/AuthenticatedGuard', () => ({
  AuthenticatedGuard:
    (
      handle: (
        req: NextRequest,
        context: {
          database: typeof mockDatabase
          currentActor: typeof mockCurrentActor
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

const createGetRequest = (actorId?: string) => {
  const url = new URL('https://llun.test/api/v1/accounts/aliases')
  if (actorId !== undefined) {
    url.searchParams.set('actorId', actorId)
  }
  return new NextRequest(url, {
    method: 'GET',
    headers: {
      origin: 'https://llun.test'
    }
  })
}

const createPostRequest = (body: unknown) => {
  return new NextRequest('https://llun.test/api/v1/accounts/aliases', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      origin: 'https://llun.test'
    }
  })
}

const createDeleteRequest = (
  body?: unknown,
  queryParams?: Record<string, string>
) => {
  const url = new URL('https://llun.test/api/v1/accounts/aliases')
  if (queryParams) {
    for (const [key, value] of Object.entries(queryParams)) {
      url.searchParams.set(key, value)
    }
  }
  return new NextRequest(url, {
    method: 'DELETE',
    ...(body !== undefined
      ? {
          body: typeof body === 'string' ? body : JSON.stringify(body),
          headers: {
            'content-type': 'application/json',
            origin: 'https://llun.test'
          }
        }
      : {
          headers: {
            origin: 'https://llun.test'
          }
        })
  })
}

describe('Accounts Aliases API route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actorRegistry.clear()
    mockStoredActor = MockActor({
      id: 'https://llun.test/users/llun'
    })
    mockStoredActor.alsoKnownAs = []
    actorRegistry.set(mockStoredActor.id, mockStoredActor)
  })

  describe('GET /api/v1/accounts/aliases', () => {
    it('returns empty aliases list with 200', async () => {
      const res = await GET(createGetRequest(), {
        params: Promise.resolve({})
      })
      expect(res.status).toBe(HTTP_STATUS.OK)
      expect(await res.json()).toEqual([])
    })

    it('returns aliases list with known and unknown actors in stored order', async () => {
      const knownActor = MockActor({
        id: 'https://other.test/users/alice'
      })
      actorRegistry.set(knownActor.id, knownActor)
      mockStoredActor.alsoKnownAs = [
        knownActor.id,
        'https://unknown.test/users/bob'
      ]

      const res = await GET(createGetRequest(), {
        params: Promise.resolve({})
      })
      expect(res.status).toBe(HTTP_STATUS.OK)
      expect(await res.json()).toEqual([
        { id: knownActor.id, acct: 'alice@other.test' },
        { id: 'https://unknown.test/users/bob', acct: null }
      ])
    })

    it('accepts matching actorId query param', async () => {
      const res = await GET(createGetRequest(mockCurrentActor.id), {
        params: Promise.resolve({})
      })
      expect(res.status).toBe(HTTP_STATUS.OK)
      expect(await res.json()).toEqual([])
    })

    it('returns 409 conflict when actorId query param mismatches current actor', async () => {
      const res = await GET(
        createGetRequest('https://llun.test/users/different'),
        {
          params: Promise.resolve({})
        }
      )
      expect(res.status).toBe(HTTP_STATUS.CONFLICT)
      expect(await res.json()).toEqual({ error: 'Actor changed' })
    })
  })

  describe('POST /api/v1/accounts/aliases', () => {
    it('adds an alias via @user@domain, updates database, federates, and returns updated list', async () => {
      const remoteActor = MockActor({
        id: 'https://remote.test/users/alice'
      })
      actorRegistry.set(remoteActor.id, remoteActor)
      vi.mocked(resolveAccountTarget).mockResolvedValueOnce({
        type: 'resolved',
        actor: remoteActor
      })

      const res = await POST(
        createPostRequest({ acct: '@alice@remote.test' }),
        {
          params: Promise.resolve({})
        }
      )
      expect(res.status).toBe(HTTP_STATUS.OK)
      expect(await res.json()).toEqual([
        { id: remoteActor.id, acct: 'alice@remote.test' }
      ])
      expect(mockDatabase.updateActorAliases).toHaveBeenCalledWith({
        actorId: mockCurrentActor.id,
        add: remoteActor.id,
        max: 10
      })
      expect(publishActorUpdate).toHaveBeenCalledWith({
        actorId: mockCurrentActor.id
      })
    })

    it('adds an alias via URL, updates database, federates, and returns updated list', async () => {
      const remoteActor = MockActor({
        id: 'https://remote.test/users/alice'
      })
      actorRegistry.set(remoteActor.id, remoteActor)
      vi.mocked(resolveAccountTarget).mockResolvedValueOnce({
        type: 'resolved',
        actor: remoteActor
      })

      const res = await POST(
        createPostRequest({ acct: 'https://remote.test/users/alice' }),
        {
          params: Promise.resolve({})
        }
      )
      expect(res.status).toBe(HTTP_STATUS.OK)
      expect(await res.json()).toEqual([
        { id: remoteActor.id, acct: 'alice@remote.test' }
      ])
      expect(mockDatabase.updateActorAliases).toHaveBeenCalledWith({
        actorId: mockCurrentActor.id,
        add: remoteActor.id,
        max: 10
      })
      expect(publishActorUpdate).toHaveBeenCalledWith({
        actorId: mockCurrentActor.id
      })
    })

    it('adds another local actor on this server successfully', async () => {
      const localActor2 = MockActor({
        id: 'https://llun.test/users/bob'
      })
      actorRegistry.set(localActor2.id, localActor2)
      vi.mocked(resolveAccountTarget).mockResolvedValueOnce({
        type: 'resolved',
        actor: localActor2
      })

      const res = await POST(createPostRequest({ acct: 'bob' }), {
        params: Promise.resolve({})
      })
      expect(res.status).toBe(HTTP_STATUS.OK)
      expect(await res.json()).toEqual([
        { id: localActor2.id, acct: 'bob@llun.test' }
      ])
      expect(mockDatabase.updateActorAliases).toHaveBeenCalledWith({
        actorId: mockCurrentActor.id,
        add: localActor2.id,
        max: 10
      })
      expect(publishActorUpdate).toHaveBeenCalledWith({
        actorId: mockCurrentActor.id
      })
    })

    it('accepts matching actorId in body', async () => {
      const remoteActor = MockActor({
        id: 'https://remote.test/users/alice'
      })
      actorRegistry.set(remoteActor.id, remoteActor)
      vi.mocked(resolveAccountTarget).mockResolvedValueOnce({
        type: 'resolved',
        actor: remoteActor
      })

      const res = await POST(
        createPostRequest({
          acct: '@alice@remote.test',
          actorId: mockCurrentActor.id
        }),
        {
          params: Promise.resolve({})
        }
      )
      expect(res.status).toBe(HTTP_STATUS.OK)
    })

    it('refuses to alias self', async () => {
      vi.mocked(resolveAccountTarget).mockResolvedValueOnce({
        type: 'resolved',
        actor: mockStoredActor
      })

      const res = await POST(createPostRequest({ acct: mockCurrentActor.id }), {
        params: Promise.resolve({})
      })
      expect(res.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY)
      expect(await res.json()).toEqual({ error: 'Cannot alias yourself' })
      expect(publishActorUpdate).not.toHaveBeenCalled()
      expect(mockDatabase.updateActorAliases).not.toHaveBeenCalled()
    })

    it('refuses duplicate alias', async () => {
      const targetActor = MockActor({
        id: 'https://remote.test/users/alice'
      })
      actorRegistry.set(targetActor.id, targetActor)
      mockStoredActor.alsoKnownAs = [targetActor.id]

      vi.mocked(resolveAccountTarget).mockResolvedValueOnce({
        type: 'resolved',
        actor: targetActor
      })

      const res = await POST(
        createPostRequest({ acct: '@alice@remote.test' }),
        {
          params: Promise.resolve({})
        }
      )
      expect(res.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY)
      expect(await res.json()).toEqual({ error: 'Alias already added' })
      expect(publishActorUpdate).not.toHaveBeenCalled()
      expect(mockDatabase.updateActorAliases).toHaveBeenCalledWith({
        actorId: mockCurrentActor.id,
        add: targetActor.id,
        max: 10
      })
    })

    it('refuses alias when cap at 10 is reached', async () => {
      mockStoredActor.alsoKnownAs = Array.from(
        { length: 10 },
        (_, i) => `https://remote.test/users/alias${i}`
      )
      const eleventh = MockActor({
        id: 'https://remote.test/users/eleventh'
      })
      actorRegistry.set(eleventh.id, eleventh)

      vi.mocked(resolveAccountTarget).mockResolvedValueOnce({
        type: 'resolved',
        actor: eleventh
      })

      const res = await POST(
        createPostRequest({ acct: '@eleventh@remote.test' }),
        {
          params: Promise.resolve({})
        }
      )
      expect(res.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY)
      expect(await res.json()).toEqual({ error: 'Too many aliases' })
      expect(publishActorUpdate).not.toHaveBeenCalled()
      expect(mockDatabase.updateActorAliases).toHaveBeenCalledWith({
        actorId: mockCurrentActor.id,
        add: eleventh.id,
        max: 10
      })
    })

    it('returns 422 Invalid account when resolver returns invalid', async () => {
      vi.mocked(resolveAccountTarget).mockResolvedValueOnce({
        type: 'invalid'
      })

      const res = await POST(createPostRequest({ acct: 'not-an-account' }), {
        params: Promise.resolve({})
      })
      expect(res.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY)
      expect(await res.json()).toEqual({ error: 'Invalid account' })
      expect(publishActorUpdate).not.toHaveBeenCalled()
    })

    it('returns 403 Forbidden when resolver returns forbidden', async () => {
      vi.mocked(resolveAccountTarget).mockResolvedValueOnce({
        type: 'forbidden'
      })

      const res = await POST(
        createPostRequest({ acct: '@blocked@blocked.test' }),
        {
          params: Promise.resolve({})
        }
      )
      expect(res.status).toBe(HTTP_STATUS.FORBIDDEN)
      expect(await res.json()).toEqual({ error: 'Forbidden' })
      expect(publishActorUpdate).not.toHaveBeenCalled()
    })

    it('returns 404 Record not found when resolver returns not-found', async () => {
      vi.mocked(resolveAccountTarget).mockResolvedValueOnce({
        type: 'not-found'
      })

      const res = await POST(
        createPostRequest({ acct: '@missing@remote.test' }),
        {
          params: Promise.resolve({})
        }
      )
      expect(res.status).toBe(HTTP_STATUS.NOT_FOUND)
      expect(await res.json()).toEqual({ error: 'Record not found' })
      expect(publishActorUpdate).not.toHaveBeenCalled()
    })

    it('returns 409 Conflict when body actorId mismatches current actor', async () => {
      const res = await POST(
        createPostRequest({
          acct: '@alice@remote.test',
          actorId: 'https://llun.test/users/other'
        }),
        {
          params: Promise.resolve({})
        }
      )
      expect(res.status).toBe(HTTP_STATUS.CONFLICT)
      expect(await res.json()).toEqual({ error: 'Actor changed' })
      expect(resolveAccountTarget).not.toHaveBeenCalled()
      expect(publishActorUpdate).not.toHaveBeenCalled()
    })

    it('returns 400 on invalid JSON and 422 on schema failure', async () => {
      const invalidJsonRes = await POST(createPostRequest('invalid-json{'), {
        params: Promise.resolve({})
      })
      expect(invalidJsonRes.status).toBe(HTTP_STATUS.BAD_REQUEST)
      expect(await invalidJsonRes.json()).toEqual({ error: 'Invalid request' })
      expect(
        invalidJsonRes.headers.get('Access-Control-Allow-Origin')
      ).toBeDefined()

      const schemaFailureRes = await POST(createPostRequest({}), {
        params: Promise.resolve({})
      })
      expect(schemaFailureRes.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY)
      expect(await schemaFailureRes.json()).toEqual({
        error: 'Invalid account'
      })
    })
  })

  describe('DELETE /api/v1/accounts/aliases', () => {
    it('removes existing alias, updates database, federates, and returns remaining list', async () => {
      const alice = MockActor({ id: 'https://remote.test/users/alice' })
      const bob = MockActor({ id: 'https://remote.test/users/bob' })
      actorRegistry.set(alice.id, alice)
      actorRegistry.set(bob.id, bob)
      mockStoredActor.alsoKnownAs = [alice.id, bob.id]

      const res = await DELETE(createDeleteRequest({ id: alice.id }), {
        params: Promise.resolve({})
      })
      expect(res.status).toBe(HTTP_STATUS.OK)
      expect(await res.json()).toEqual([
        { id: bob.id, acct: 'bob@remote.test' }
      ])
      expect(mockDatabase.updateActorAliases).toHaveBeenCalledWith({
        actorId: mockCurrentActor.id,
        remove: alice.id,
        max: 10
      })
      expect(publishActorUpdate).toHaveBeenCalledWith({
        actorId: mockCurrentActor.id
      })
    })

    it('clears all aliases when deleting the only alias', async () => {
      const alice = MockActor({ id: 'https://remote.test/users/alice' })
      actorRegistry.set(alice.id, alice)
      mockStoredActor.alsoKnownAs = [alice.id]

      const res = await DELETE(createDeleteRequest({ id: alice.id }), {
        params: Promise.resolve({})
      })
      expect(res.status).toBe(HTTP_STATUS.OK)
      expect(await res.json()).toEqual([])
      expect(mockDatabase.updateActorAliases).toHaveBeenCalledWith({
        actorId: mockCurrentActor.id,
        remove: alice.id,
        max: 10
      })
      expect(publishActorUpdate).toHaveBeenCalledWith({
        actorId: mockCurrentActor.id
      })
    })

    it('accepts matching actorId in body', async () => {
      const alice = MockActor({ id: 'https://remote.test/users/alice' })
      actorRegistry.set(alice.id, alice)
      mockStoredActor.alsoKnownAs = [alice.id]

      const res = await DELETE(
        createDeleteRequest({
          id: alice.id,
          actorId: mockCurrentActor.id
        }),
        {
          params: Promise.resolve({})
        }
      )
      expect(res.status).toBe(HTTP_STATUS.OK)
      expect(await res.json()).toEqual([])
    })

    it('returns 404 Record not found when alias does not exist', async () => {
      mockStoredActor.alsoKnownAs = []

      const res = await DELETE(
        createDeleteRequest({ id: 'https://remote.test/users/charlie' }),
        {
          params: Promise.resolve({})
        }
      )
      expect(res.status).toBe(HTTP_STATUS.NOT_FOUND)
      expect(await res.json()).toEqual({ error: 'Record not found' })
      expect(publishActorUpdate).not.toHaveBeenCalled()
      expect(mockDatabase.updateActorAliases).toHaveBeenCalledWith({
        actorId: mockCurrentActor.id,
        remove: 'https://remote.test/users/charlie',
        max: 10
      })
    })

    it('returns 409 Conflict when body actorId mismatches current actor', async () => {
      const res = await DELETE(
        createDeleteRequest({
          id: 'https://remote.test/users/alice',
          actorId: 'https://llun.test/users/other'
        }),
        {
          params: Promise.resolve({})
        }
      )
      expect(res.status).toBe(HTTP_STATUS.CONFLICT)
      expect(await res.json()).toEqual({ error: 'Actor changed' })
      expect(publishActorUpdate).not.toHaveBeenCalled()
      expect(mockDatabase.updateActorAliases).not.toHaveBeenCalled()
    })

    it('accepts id from query string when body is empty', async () => {
      const alice = MockActor({ id: 'https://remote.test/users/alice' })
      const bob = MockActor({ id: 'https://remote.test/users/bob' })
      actorRegistry.set(alice.id, alice)
      actorRegistry.set(bob.id, bob)
      mockStoredActor.alsoKnownAs = [alice.id, bob.id]

      const url = new URL('https://llun.test/api/v1/accounts/aliases')
      url.searchParams.set('id', alice.id)
      const req = new NextRequest(url, {
        method: 'DELETE',
        headers: {
          origin: 'https://llun.test'
        }
      })

      const res = await DELETE(req, {
        params: Promise.resolve({})
      })
      expect(res.status).toBe(HTTP_STATUS.OK)
      expect(await res.json()).toEqual([
        { id: bob.id, acct: 'bob@remote.test' }
      ])
      expect(mockDatabase.updateActorAliases).toHaveBeenCalledWith({
        actorId: mockCurrentActor.id,
        remove: alice.id,
        max: 10
      })
      expect(publishActorUpdate).toHaveBeenCalledWith({
        actorId: mockCurrentActor.id
      })
    })

    it('accepts matching actorId in query string when body is empty', async () => {
      const alice = MockActor({ id: 'https://remote.test/users/alice' })
      actorRegistry.set(alice.id, alice)
      mockStoredActor.alsoKnownAs = [alice.id]

      const url = new URL('https://llun.test/api/v1/accounts/aliases')
      url.searchParams.set('id', alice.id)
      url.searchParams.set('actorId', mockCurrentActor.id)
      const req = new NextRequest(url, {
        method: 'DELETE',
        headers: {
          origin: 'https://llun.test'
        }
      })

      const res = await DELETE(req, {
        params: Promise.resolve({})
      })
      expect(res.status).toBe(HTTP_STATUS.OK)
      expect(await res.json()).toEqual([])
    })

    it('returns 409 Conflict when query actorId mismatches current actor with empty body', async () => {
      const url = new URL('https://llun.test/api/v1/accounts/aliases')
      url.searchParams.set('id', 'https://remote.test/users/alice')
      url.searchParams.set('actorId', 'https://llun.test/users/other')
      const req = new NextRequest(url, {
        method: 'DELETE',
        headers: {
          origin: 'https://llun.test'
        }
      })

      const res = await DELETE(req, {
        params: Promise.resolve({})
      })
      expect(res.status).toBe(HTTP_STATUS.CONFLICT)
      expect(await res.json()).toEqual({ error: 'Actor changed' })
      expect(publishActorUpdate).not.toHaveBeenCalled()
      expect(mockDatabase.updateActorAliases).not.toHaveBeenCalled()
    })

    it('returns 422 Invalid request when body is empty and no query params are provided', async () => {
      const req = new NextRequest('https://llun.test/api/v1/accounts/aliases', {
        method: 'DELETE',
        headers: {
          origin: 'https://llun.test'
        }
      })

      const res = await DELETE(req, {
        params: Promise.resolve({})
      })
      expect(res.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY)
      expect(await res.json()).toEqual({ error: 'Invalid request' })
      expect(publishActorUpdate).not.toHaveBeenCalled()
      expect(mockDatabase.updateActorAliases).not.toHaveBeenCalled()
    })

    it('returns 400 on invalid JSON and 422 on schema failure', async () => {
      const invalidJsonRes = await DELETE(
        createDeleteRequest('invalid-json{'),
        {
          params: Promise.resolve({})
        }
      )
      expect(invalidJsonRes.status).toBe(HTTP_STATUS.BAD_REQUEST)
      expect(await invalidJsonRes.json()).toEqual({ error: 'Invalid request' })
      expect(
        invalidJsonRes.headers.get('Access-Control-Allow-Origin')
      ).toBeDefined()

      const schemaFailureRes = await DELETE(createDeleteRequest({}), {
        params: Promise.resolve({})
      })
      expect(schemaFailureRes.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY)
      expect(await schemaFailureRes.json()).toEqual({
        error: 'Invalid request'
      })
    })
  })

  describe('OPTIONS', () => {
    it('returns 200 with allowed methods', async () => {
      const req = new NextRequest('http://localhost/api/v1/accounts/aliases', {
        method: 'OPTIONS'
      })
      const res = await OPTIONS(req)
      expect(res.status).toBe(200)
      expect(res.headers.get('Access-Control-Allow-Methods')).toBe(
        'GET,POST,DELETE'
      )
    })
  })
})
