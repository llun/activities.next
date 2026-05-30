import { NextRequest, NextResponse } from 'next/server'

import { Database } from '@/lib/database/types'
import { Scope } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
import { HttpMethod } from '@/lib/utils/http-headers'

import { AdminApiGuard } from './AdminApiGuard'

const mockDatabase = {} as Database
const mockGetServerSession = jest.fn()
const mockGetAdminFromSession = jest.fn()
const mockOAuthGuardAnyScope = jest.fn()
let mockOAuthActor = {
  account: { role: 'admin' }
} as Actor

jest.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

jest.mock('@/lib/utils/getAdminFromSession', () => ({
  getAdminFromSession: (...params: unknown[]) =>
    mockGetAdminFromSession(...params)
}))

jest.mock('./OAuthGuard', () => ({
  OAuthGuardAnyScope: (...params: unknown[]) =>
    mockOAuthGuardAnyScope(...params)
}))

describe('AdminApiGuard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
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

  const handle = jest.fn(() => NextResponse.json({ ok: true }))

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
    // Admin GET accepts read, admin:read, and any granular admin:read:* scope
    // so that least-privilege admin clients work without requesting coarse read.
    const calledScopes = mockOAuthGuardAnyScope.mock.calls[0][0] as Scope[]
    expect(calledScopes).toContain(Scope.enum.read)
    expect(calledScopes).toContain(Scope.enum['admin:read'])
    expect(calledScopes).toContain(Scope.enum['admin:read:domain_blocks'])
    expect(calledScopes).toContain(Scope.enum['admin:read:accounts'])
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

    // Admin POST accepts write, admin:write, and any granular admin:write:* scope.
    const calledScopes = mockOAuthGuardAnyScope.mock.calls[0][0] as Scope[]
    expect(calledScopes).toContain(Scope.enum.write)
    expect(calledScopes).toContain(Scope.enum['admin:write'])
    expect(calledScopes).toContain(Scope.enum['admin:write:domain_blocks'])
    expect(calledScopes).toContain(Scope.enum['admin:write:accounts'])
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
