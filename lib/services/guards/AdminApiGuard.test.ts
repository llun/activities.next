import { NextRequest, NextResponse } from 'next/server'

import { Database } from '@/lib/database/types'
import { Scope } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
import { HttpMethod } from '@/lib/utils/http-headers'

import { AdminApiGuard } from './AdminApiGuard'

const mockDatabase = {} as Database
const mockGetServerSession = vi.fn()
const mockGetAdminFromSession = vi.fn()
const mockOAuthGuardAnyScope = vi.fn()
let mockOAuthActor = {
  account: { role: 'admin' }
} as Actor

vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

vi.mock('@/lib/utils/getAdminFromSession', () => ({
  getAdminFromSession: (...params: unknown[]) =>
    mockGetAdminFromSession(...params)
}))

vi.mock('./OAuthGuard', () => ({
  OAuthGuardAnyScope: (...params: unknown[]) =>
    mockOAuthGuardAnyScope(...params)
}))

describe('AdminApiGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOAuthActor = {
      account: { role: 'admin' }
    } as Actor
    mockGetServerSession.mockResolvedValue(null)
    mockGetAdminFromSession.mockResolvedValue(null)
    mockOAuthGuardAnyScope.mockImplementation(
      (
        _scopes: Scope[],
        handle: (
          req: NextRequest,
          context: {
            currentActor: Actor
            database: Database
            params: Promise<{}>
          }
        ) => Promise<Response> | Response
      ) =>
        (req: NextRequest, context: { params: Promise<{}> }) =>
          handle(req, {
            currentActor: mockOAuthActor,
            database: mockDatabase,
            params: context.params
          })
    )
  })

  const handle = vi.fn(() => NextResponse.json({ ok: true }))

  it('allows an admin cookie session', async () => {
    const session = { user: { email: 'admin@llun.test' } }
    mockGetServerSession.mockResolvedValue(session)
    mockGetAdminFromSession.mockResolvedValue({ role: 'admin' })

    const guard = AdminApiGuard([HttpMethod.enum.GET], handle)
    const response = await guard(
      new NextRequest('https://llun.test/api/v1/admin/domain_blocks'),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    expect(handle).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({ database: mockDatabase })
    )
    expect(mockOAuthGuardAnyScope).not.toHaveBeenCalled()
  })

  it('allows an admin OAuth bearer token for read routes', async () => {
    const guard = AdminApiGuard([HttpMethod.enum.GET], handle)
    const response = await guard(
      new NextRequest('https://llun.test/api/v1/admin/domain_blocks', {
        headers: { Authorization: 'Bearer token' }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(200)
    // Without a resource option, admin GET accepts coarse read OR the aggregate
    // admin:read scope only — no granular admin:read:* scope is added.
    expect(mockOAuthGuardAnyScope).toHaveBeenCalledWith(
      [Scope.enum.read, Scope.enum['admin:read']],
      expect.any(Function)
    )
  })

  it('adds the resource granular admin:read scope for a read route', async () => {
    const guard = AdminApiGuard([HttpMethod.enum.GET], handle, {
      resource: 'domain_blocks'
    })
    await guard(
      new NextRequest('https://llun.test/api/v1/admin/domain_blocks', {
        headers: { Authorization: 'Bearer token' }
      }),
      { params: Promise.resolve({}) }
    )

    // The domain_blocks route additionally accepts its own granular
    // admin:read:domain_blocks scope, without widening any other admin route.
    expect(mockOAuthGuardAnyScope).toHaveBeenCalledWith(
      [
        Scope.enum.read,
        Scope.enum['admin:read'],
        Scope.enum['admin:read:domain_blocks']
      ],
      expect.any(Function)
    )
  })

  it('adds the resource granular admin:write scope for a non-GET route', async () => {
    const guard = AdminApiGuard([HttpMethod.enum.POST], handle, {
      resource: 'domain_allows'
    })
    await guard(
      new NextRequest('https://llun.test/api/v1/admin/domain_allows', {
        method: 'POST',
        headers: { Authorization: 'Bearer token' }
      }),
      { params: Promise.resolve({}) }
    )

    expect(mockOAuthGuardAnyScope).toHaveBeenCalledWith(
      [
        Scope.enum.write,
        Scope.enum['admin:write'],
        Scope.enum['admin:write:domain_allows']
      ],
      expect.any(Function)
    )
  })

  it('requires write scope for non-GET admin routes', async () => {
    const guard = AdminApiGuard([HttpMethod.enum.POST], handle)
    await guard(
      new NextRequest('https://llun.test/api/v1/admin/domain_blocks', {
        method: 'POST',
        headers: { Authorization: 'Bearer token' }
      }),
      { params: Promise.resolve({}) }
    )

    // Admin POST accepts coarse write OR the aggregate admin:write scope.
    expect(mockOAuthGuardAnyScope).toHaveBeenCalledWith(
      [Scope.enum.write, Scope.enum['admin:write']],
      expect.any(Function)
    )
  })

  it('rejects a non-admin OAuth bearer token', async () => {
    mockOAuthActor = {
      account: { role: 'user' }
    } as Actor

    const guard = AdminApiGuard([HttpMethod.enum.GET], handle)
    const response = await guard(
      new NextRequest('https://llun.test/api/v1/admin/domain_blocks', {
        headers: { Authorization: 'Bearer token' }
      }),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(403)
  })

  it('rejects requests without session or bearer token', async () => {
    const guard = AdminApiGuard([HttpMethod.enum.GET], handle)
    const response = await guard(
      new NextRequest('https://llun.test/api/v1/admin/domain_blocks'),
      { params: Promise.resolve({}) }
    )

    expect(response.status).toBe(403)
    expect(mockOAuthGuardAnyScope).not.toHaveBeenCalled()
  })
})
