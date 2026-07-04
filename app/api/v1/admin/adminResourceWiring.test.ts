// Guards against an admin route hard-coding the WRONG `resource` literal.
// TypeScript only checks the value is a valid AdminResource key, so a route
// passing e.g. resource: 'domain_allows' on a domain_blocks endpoint compiles
// fine and would silently grant the wrong granular admin scope — breaking the
// cross-resource isolation the { resource } option exists to provide. This test
// captures the option each route passes to AdminApiGuard and asserts it matches
// the route's own resource.

const adminGuardCalls: Array<{ resource?: string }> = []
vi.mock('@/lib/services/guards/AdminApiGuard', () => ({
  AdminApiGuard: (
    _allowedMethods: unknown,
    _handle: unknown,
    options: { resource?: string } = {}
  ) => {
    adminGuardCalls.push(options)
    return () => new Response(null)
  }
}))

describe('admin domain route resource wiring', () => {
  beforeEach(() => {
    adminGuardCalls.length = 0
  })

  it('every domain_blocks route wires resource "domain_blocks"', async () => {
    await import('@/app/api/v1/admin/domain_blocks/route')
    await import('@/app/api/v1/admin/domain_blocks/[id]/route')
    await import('@/app/api/v1/admin/domain_blocks/import/route')

    expect(adminGuardCalls.length).toBeGreaterThan(0)
    expect(adminGuardCalls.map((call) => call.resource)).toEqual(
      adminGuardCalls.map(() => 'domain_blocks')
    )
  })

  it('every domain_allows route wires resource "domain_allows"', async () => {
    await import('@/app/api/v1/admin/domain_allows/route')
    await import('@/app/api/v1/admin/domain_allows/[id]/route')

    expect(adminGuardCalls.length).toBeGreaterThan(0)
    expect(adminGuardCalls.map((call) => call.resource)).toEqual(
      adminGuardCalls.map(() => 'domain_allows')
    )
  })
})
