import { NextRequest } from 'next/server'

import { getTestSQLDatabaseWithInstance } from '@/lib/database/testUtils'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { EXTERNAL_ACTOR1, seedExternal1 } from '@/lib/stub/seed/external1'
import { urlToId } from '@/lib/utils/urlToId'

const { database, instance } = getTestSQLDatabaseWithInstance()

const ADMIN_ACTOR_ID = `https://${TEST_DOMAIN}/users/admin`
const TARGET_ACTOR_ID = `https://${TEST_DOMAIN}/users/target`
let adminAccountId = ''

const mockPublish = vi.fn()
const mockGetAdminFromSession = vi.fn()

vi.mock('@/lib/database', () => ({
  getDatabase: () => database,
  getKnex: () => instance
}))
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi
    .fn()
    .mockResolvedValue({ user: { email: `admin@${TEST_DOMAIN}` } })
}))
vi.mock('@/lib/utils/getAdminFromSession', () => ({
  getAdminFromSession: (...args: unknown[]) => mockGetAdminFromSession(...args)
}))
vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({ publish: mockPublish })
}))

// Loaded after the mocks are registered.
let listRoute: typeof import('./route')
let listRouteV2: typeof import('@/app/api/v2/admin/accounts/route')
let idRoute: typeof import('./[id]/route')
let actionRoute: typeof import('./[id]/action/route')
let unsuspendRoute: typeof import('./[id]/unsuspend/route')

const adminRequest = (
  path: string,
  init: { method?: string; body?: unknown } = {}
) =>
  new NextRequest(`https://${TEST_DOMAIN}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Origin: `https://${TEST_DOMAIN}`,
      'content-type': 'application/json'
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {})
  })

describe('admin accounts API', () => {
  beforeAll(async () => {
    await database.migrate()
    adminAccountId = await database.createAccount({
      email: `admin@${TEST_DOMAIN}`,
      username: 'admin',
      passwordHash: 'hash',
      domain: TEST_DOMAIN,
      privateKey: 'private',
      publicKey: 'public'
    })
    await instance('accounts')
      .where('id', adminAccountId)
      .update({ role: 'admin' })
    await database.createAccount({
      email: `target@${TEST_DOMAIN}`,
      username: 'target',
      passwordHash: 'hash',
      domain: TEST_DOMAIN,
      privateKey: 'private',
      publicKey: 'public'
    })
    await database.createActor(seedExternal1)

    listRoute = await import('./route')
    listRouteV2 = await import('@/app/api/v2/admin/accounts/route')
    idRoute = await import('./[id]/route')
    actionRoute = await import('./[id]/action/route')
    unsuspendRoute = await import('./[id]/unsuspend/route')
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    mockPublish.mockReset()
    mockGetAdminFromSession.mockResolvedValue({
      id: adminAccountId,
      defaultActorId: ADMIN_ACTOR_ID
    })
  })

  it('lists accounts and round-trips the id space through GET :id', async () => {
    const listResponse = await listRoute.GET(
      adminRequest('/api/v1/admin/accounts'),
      {
        params: Promise.resolve({})
      }
    )
    expect(listResponse.status).toBe(200)
    const list = await listResponse.json()
    const ids = list.map((account: { id: string }) => account.id)
    expect(ids).toContain(urlToId(TARGET_ACTOR_ID))
    expect(ids).toContain(urlToId(EXTERNAL_ACTOR1))

    const id = urlToId(TARGET_ACTOR_ID)
    const getResponse = await idRoute.GET(
      adminRequest(`/api/v1/admin/accounts/${id}`),
      { params: Promise.resolve({ id }) }
    )
    expect(getResponse.status).toBe(200)
    const entity = await getResponse.json()
    expect(entity.id).toBe(id)
    expect(entity.username).toBe('target')
    expect(entity.domain).toBeNull()
  })

  it('applies a suspend action, records the audit row, and 422s disabling a remote account', async () => {
    const id = urlToId(TARGET_ACTOR_ID)
    const suspend = await actionRoute.POST(
      adminRequest(`/api/v1/admin/accounts/${id}/action`, {
        method: 'POST',
        body: { type: 'suspend', text: 'spam' }
      }),
      { params: Promise.resolve({ id }) }
    )
    expect(suspend.status).toBe(200)

    const refreshed = await database.getAdminAccount({
      actorId: TARGET_ACTOR_ID
    })
    expect(refreshed?.actor.suspendedAt).toBeTruthy()
    const audit = await instance('moderation_actions')
      .where('targetActorId', TARGET_ACTOR_ID)
      .first()
    expect(audit.action).toBe('suspend')
    expect(audit.moderatorAccountId).toBe(adminAccountId)

    // disable is local-only — a remote target 422s.
    const remoteId = urlToId(EXTERNAL_ACTOR1)
    const disableRemote = await actionRoute.POST(
      adminRequest(`/api/v1/admin/accounts/${remoteId}/action`, {
        method: 'POST',
        body: { type: 'disable' }
      }),
      { params: Promise.resolve({ id: remoteId }) }
    )
    expect(disableRemote.status).toBe(422)
  })

  it('unsuspends a suspended account and 422s unsuspending an active one', async () => {
    const id = urlToId(TARGET_ACTOR_ID)
    // Target is suspended from the previous test.
    const unsuspend = await unsuspendRoute.POST(
      adminRequest(`/api/v1/admin/accounts/${id}/unsuspend`, {
        method: 'POST'
      }),
      { params: Promise.resolve({ id }) }
    )
    expect(unsuspend.status).toBe(200)
    const entity = await unsuspend.json()
    expect(entity.suspended).toBe(false)

    // Now it is active — a second unsuspend 422s.
    const again = await unsuspendRoute.POST(
      adminRequest(`/api/v1/admin/accounts/${id}/unsuspend`, {
        method: 'POST'
      }),
      { params: Promise.resolve({ id }) }
    )
    expect(again.status).toBe(422)
  })

  it('maps v2 origin=remote to remote actors and short-circuits role_ids[] to empty', async () => {
    const remoteOnly = await listRouteV2.GET(
      adminRequest('/api/v2/admin/accounts?origin=remote'),
      { params: Promise.resolve({}) }
    )
    expect(remoteOnly.status).toBe(200)
    const remoteList = await remoteOnly.json()
    const remoteIds = remoteList.map((account: { id: string }) => account.id)
    expect(remoteIds).toContain(urlToId(EXTERNAL_ACTOR1))
    expect(remoteIds).not.toContain(urlToId(TARGET_ACTOR_ID))

    // No roles subsystem: a role_ids[] filter can never match — empty page.
    const byRole = await listRouteV2.GET(
      adminRequest('/api/v2/admin/accounts?role_ids[]=3'),
      { params: Promise.resolve({}) }
    )
    expect(byRole.status).toBe(200)
    expect(await byRole.json()).toEqual([])
  })

  it('requires suspension before DELETE and then schedules the purge job', async () => {
    const id = urlToId(TARGET_ACTOR_ID)

    const tooEarly = await idRoute.DELETE(
      adminRequest(`/api/v1/admin/accounts/${id}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id }) }
    )
    expect(tooEarly.status).toBe(422)
    expect(mockPublish).not.toHaveBeenCalled()

    await database.setActorSuspended({
      actorId: TARGET_ACTOR_ID,
      suspended: true
    })
    const deleted = await idRoute.DELETE(
      adminRequest(`/api/v1/admin/accounts/${id}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id }) }
    )
    expect(deleted.status).toBe(200)
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'DeleteActorJob' })
    )
  })
})
