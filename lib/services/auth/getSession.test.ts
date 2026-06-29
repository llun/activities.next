const getSessionMock = vi.fn()
vi.mock('./auth', () => ({
  getAuth: () => ({ api: { getSession: getSessionMock } })
}))

const headersMock = vi.fn(async () => new Headers())
vi.mock('next/headers', () => ({ headers: () => headersMock() }))

const loggerErrorMock = vi.fn()
vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: (...args: unknown[]) => loggerErrorMock(...args),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }
}))

describe('getServerAuthSession', () => {
  beforeEach(() => {
    // Fresh module each test so React's cache() does not memoize across cases.
    vi.resetModules()
    getSessionMock.mockReset()
    loggerErrorMock.mockReset()
    headersMock.mockClear()
  })

  it('returns the session better-auth resolves', async () => {
    const session = { user: { email: 'rider@example.com' } }
    getSessionMock.mockResolvedValue(session)

    const { getServerAuthSession } = await import('./getSession')

    expect(await getServerAuthSession()).toEqual(session)
    expect(loggerErrorMock).not.toHaveBeenCalled()
  })

  it('returns null when there is no session', async () => {
    getSessionMock.mockResolvedValue(null)

    const { getServerAuthSession } = await import('./getSession')

    expect(await getServerAuthSession()).toBeNull()
    expect(loggerErrorMock).not.toHaveBeenCalled()
  })

  it('fails closed (logs + returns null) when session resolution throws, e.g. a JWKS signing error', async () => {
    // Mirrors the jwt plugin's /get-session after-hook failing to sign the
    // set-auth-jwt header with an incompatible JWKS key.
    getSessionMock.mockRejectedValue(
      new Error('Invalid or unsupported JWK "alg" (Algorithm) Parameter value')
    )

    const { getServerAuthSession } = await import('./getSession')

    expect(await getServerAuthSession()).toBeNull()
    expect(loggerErrorMock).toHaveBeenCalledTimes(1)
    // The error must travel under `err` so the logger's GCP formatter extracts
    // its stack trace into `stack_trace`.
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to resolve auth session',
        err: expect.any(Error)
      })
    )
  })

  it('lets a headers() dynamic-rendering bailout propagate instead of swallowing it', async () => {
    // headers() throws an internal control-flow signal during static generation
    // to bail the route out to dynamic rendering; it is resolved outside the
    // try/catch so it must propagate (not be turned into a null session, which
    // would let Next.js statically cache the page as unauthenticated).
    const dynamicBailout = new Error('Dynamic server usage')
    headersMock.mockRejectedValueOnce(dynamicBailout)

    const { getServerAuthSession } = await import('./getSession')

    await expect(getServerAuthSession()).rejects.toThrow(dynamicBailout)
    expect(getSessionMock).not.toHaveBeenCalled()
    expect(loggerErrorMock).not.toHaveBeenCalled()
  })
})
