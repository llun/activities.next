import { NextRequest } from 'next/server'

import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'

import { DELETE, GET, PATCH } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase:
  ReturnType<typeof getTestDatabaseWithInstance>['database'] | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined })
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    host: 'llun.test',
    secretPhase: 'test-secret',
    allowEmails: [],
    allowActorDomains: []
  })
}))

describe('/api/v1/gallery/gears/[id]', () => {
  const { database, prepare } = getTestDatabaseWithInstance()

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  const url = (id: string) => `https://llun.test/api/v1/gallery/gears/${id}`
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

  const createGear = (name: string, actorId = ACTOR1_ID) =>
    database.createGalleryGear({
      actorId,
      kind: 'camera',
      name,
      brand: 'Canon',
      model: 'R5',
      productUrl: 'https://canon.test/r5'
    })

  const patch = (id: string, body: unknown, raw = false) =>
    PATCH(
      new NextRequest(url(id), {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          origin: 'https://llun.test'
        },
        body: raw ? (body as string) : JSON.stringify(body)
      }),
      ctx(id)
    )

  const del = (id: string) =>
    DELETE(
      new NextRequest(url(id), {
        method: 'DELETE',
        headers: { origin: 'https://llun.test' }
      }),
      ctx(id)
    )

  describe('GET', () => {
    it('answers the gear with its usage', async () => {
      const gear = await createGear('Detail camera')

      const response = await GET(
        new NextRequest(url(gear.id), { method: 'GET' }),
        ctx(gear.id)
      )

      expect(response.status).toBe(200)
      expect((await response.json()).gear).toMatchObject({
        id: gear.id,
        name: 'Detail camera',
        kind: 'camera',
        photoCount: 0,
        firstUsedAt: null,
        lastUsedAt: null
      })
    })

    it('answers 404 for a missing id and for another actor’s gear', async () => {
      const foreign = await createGear('Foreign camera', ACTOR2_ID)

      for (const id of ['missing', foreign.id]) {
        const response = await GET(
          new NextRequest(url(id), { method: 'GET' }),
          ctx(id)
        )
        expect(response.status).toBe(404)
      }
    })

    it('redirects to sign-in without a session', async () => {
      mockGetServerSession.mockResolvedValue(null)

      const response = await GET(
        new NextRequest(url('any'), { method: 'GET' }),
        ctx('any')
      )

      expect(response.status).toBe(307)
    })
  })

  describe('PATCH', () => {
    it('updates the given fields and leaves the others', async () => {
      const gear = await createGear('Patch me')

      const response = await patch(gear.id, { name: '  Renamed  ' })

      expect(response.status).toBe(200)
      expect((await response.json()).gear).toMatchObject({
        id: gear.id,
        name: 'Renamed',
        brand: 'Canon',
        model: 'R5',
        productUrl: 'https://canon.test/r5'
      })
    })

    it('treats a blank optional field as a clear', async () => {
      const gear = await createGear('Clear me')

      const response = await patch(gear.id, { brand: '  ', productUrl: null })

      expect(response.status).toBe(200)
      expect((await response.json()).gear).toMatchObject({
        name: 'Clear me',
        brand: null,
        model: 'R5',
        productUrl: null
      })
    })

    it('answers 404 for another actor’s gear and leaves it alone', async () => {
      const foreign = await createGear('Not mine', ACTOR2_ID)

      const response = await patch(foreign.id, { name: 'Mine now' })

      expect(response.status).toBe(404)
      expect(
        await database.getGalleryGear({ id: foreign.id, actorId: ACTOR2_ID })
      ).toMatchObject({ name: 'Not mine' })
    })

    it.each([
      ['an empty body', {}],
      ['only unknown keys', { colour: 'red' }],
      ['a blank name', { name: '   ' }],
      ['a name over 255 characters', { name: 'x'.repeat(256) }],
      ['a javascript: product url', { productUrl: 'javascript:alert(1)' }],
      ['a non-object body', []]
    ])('answers 422 for %s', async (_, body) => {
      const gear = await createGear('Validated')

      const response = await patch(gear.id, body)

      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({ error: 'Unprocessable entity' })
    })

    it('does not change the kind', async () => {
      const gear = await createGear('Kind fixed')

      const response = await patch(gear.id, { kind: 'lens', name: 'Same kind' })

      expect(response.status).toBe(200)
      expect((await response.json()).gear.kind).toBe('camera')
    })

    it('answers 400 for a body that is not JSON', async () => {
      const gear = await createGear('Bad json')

      const response = await patch(gear.id, '{nope', true)

      expect(response.status).toBe(400)
    })

    it('rejects a cross-site request', async () => {
      const gear = await createGear('Cross site')

      const response = await PATCH(
        new NextRequest(url(gear.id), {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            origin: 'https://evil.test'
          },
          body: JSON.stringify({ name: 'Evil' })
        }),
        ctx(gear.id)
      )

      expect(response.status).toBe(403)
    })
  })

  describe('DELETE', () => {
    it('deletes the gear and answers 404 the second time', async () => {
      const gear = await createGear('Delete me')

      const first = await del(gear.id)
      expect(first.status).toBe(200)
      expect(await first.json()).toEqual({ status: 'OK' })
      expect(
        await database.getGalleryGear({ id: gear.id, actorId: ACTOR1_ID })
      ).toBeNull()

      expect((await del(gear.id)).status).toBe(404)
    })

    it('answers 404 for another actor’s gear and keeps it', async () => {
      const foreign = await createGear('Keep me', ACTOR2_ID)

      expect((await del(foreign.id)).status).toBe(404)
      expect(
        await database.getGalleryGear({ id: foreign.id, actorId: ACTOR2_ID })
      ).not.toBeNull()
    })
  })
})
