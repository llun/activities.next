import { NextRequest } from 'next/server'

import { getTestSQLDatabaseWithInstance } from '@/lib/database/testUtils'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { urlToId } from '@/lib/utils/urlToId'

const { database, instance } = getTestSQLDatabaseWithInstance()

const ADMIN_ACTOR_ID = `https://${TEST_DOMAIN}/users/admin`
const TARGET_ACTOR_ID = `https://${TEST_DOMAIN}/users/target`
let adminAccountId = ''
let reportId = ''
let statusId = ''
let ruleId = ''

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

let listRoute: typeof import('./route')
let idRoute: typeof import('./[id]/route')
let assignRoute: typeof import('./[id]/assign_to_self/route')
let unassignRoute: typeof import('./[id]/unassign/route')
let resolveRoute: typeof import('./[id]/resolve/route')
let reopenRoute: typeof import('./[id]/reopen/route')

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

describe('admin reports API', () => {
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
    const status = await database.createNote({
      id: `${TARGET_ACTOR_ID}/statuses/reported-1`,
      url: `${TARGET_ACTOR_ID}/statuses/reported-1`,
      actorId: TARGET_ACTOR_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'reported content'
    })
    statusId = status.id
    const rule = await database.createInstanceRule({
      text: 'No spam',
      hint: 'Do not spam'
    })
    ruleId = rule.id
    const report = await database.createReport({
      actorId: ADMIN_ACTOR_ID,
      targetActorId: TARGET_ACTOR_ID,
      category: 'other',
      statusIds: [statusId],
      ruleIds: [ruleId]
    })
    reportId = report.id

    listRoute = await import('./route')
    idRoute = await import('./[id]/route')
    assignRoute = await import('./[id]/assign_to_self/route')
    unassignRoute = await import('./[id]/unassign/route')
    resolveRoute = await import('./[id]/resolve/route')
    reopenRoute = await import('./[id]/reopen/route')
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    mockGetAdminFromSession.mockResolvedValue({
      id: adminAccountId,
      defaultActorId: ADMIN_ACTOR_ID
    })
  })

  it('lists reports and serializes the full Admin::Report on GET :id', async () => {
    const list = await listRoute.GET(adminRequest('/api/v1/admin/reports'), {
      params: Promise.resolve({})
    })
    expect(list.status).toBe(200)
    expect((await list.json()).map((r: { id: string }) => r.id)).toContain(
      reportId
    )

    const detail = await idRoute.GET(
      adminRequest(`/api/v1/admin/reports/${reportId}`),
      { params: Promise.resolve({ id: reportId }) }
    )
    expect(detail.status).toBe(200)
    const entity = await detail.json()
    expect(entity.id).toBe(reportId)
    expect(entity.account.id).toBe(urlToId(ADMIN_ACTOR_ID))
    expect(entity.target_account.id).toBe(urlToId(TARGET_ACTOR_ID))
    expect(entity.statuses).toHaveLength(1)
    expect(entity.rules.map((rule: { id: string }) => rule.id)).toEqual([
      ruleId
    ])
    expect(entity.assigned_account).toBeNull()
  })

  it('updates category and 422s unknown rule_ids', async () => {
    const ok = await idRoute.PUT(
      adminRequest(`/api/v1/admin/reports/${reportId}`, {
        method: 'PUT',
        body: { category: 'spam', rule_ids: [ruleId] }
      }),
      { params: Promise.resolve({ id: reportId }) }
    )
    expect(ok.status).toBe(200)
    expect((await ok.json()).category).toBe('spam')

    const bad = await idRoute.PUT(
      adminRequest(`/api/v1/admin/reports/${reportId}`, {
        method: 'PUT',
        body: { rule_ids: ['does-not-exist'] }
      }),
      { params: Promise.resolve({ id: reportId }) }
    )
    expect(bad.status).toBe(422)
  })

  it('assigns, resolves, reopens, and unassigns through the workflow', async () => {
    const assigned = await assignRoute.POST(
      adminRequest(`/api/v1/admin/reports/${reportId}/assign_to_self`, {
        method: 'POST'
      }),
      { params: Promise.resolve({ id: reportId }) }
    )
    expect(assigned.status).toBe(200)
    expect((await assigned.json()).assigned_account.id).toBe(
      urlToId(ADMIN_ACTOR_ID)
    )

    const resolved = await resolveRoute.POST(
      adminRequest(`/api/v1/admin/reports/${reportId}/resolve`, {
        method: 'POST'
      }),
      { params: Promise.resolve({ id: reportId }) }
    )
    const resolvedEntity = await resolved.json()
    expect(resolvedEntity.action_taken).toBe(true)
    expect(resolvedEntity.action_taken_at).not.toBeNull()
    expect(resolvedEntity.action_taken_by_account.id).toBe(
      urlToId(ADMIN_ACTOR_ID)
    )

    const reopened = await reopenRoute.POST(
      adminRequest(`/api/v1/admin/reports/${reportId}/reopen`, {
        method: 'POST'
      }),
      { params: Promise.resolve({ id: reportId }) }
    )
    const reopenedEntity = await reopened.json()
    expect(reopenedEntity.action_taken).toBe(false)
    expect(reopenedEntity.action_taken_at).toBeNull()

    const unassigned = await unassignRoute.POST(
      adminRequest(`/api/v1/admin/reports/${reportId}/unassign`, {
        method: 'POST'
      }),
      { params: Promise.resolve({ id: reportId }) }
    )
    expect((await unassigned.json()).assigned_account).toBeNull()
  })

  it('422s assign_to_self when the cookie admin has no actor', async () => {
    mockGetAdminFromSession.mockResolvedValue({
      id: adminAccountId,
      defaultActorId: null
    })
    const response = await assignRoute.POST(
      adminRequest(`/api/v1/admin/reports/${reportId}/assign_to_self`, {
        method: 'POST'
      }),
      { params: Promise.resolve({ id: reportId }) }
    )
    expect(response.status).toBe(422)
  })
})
