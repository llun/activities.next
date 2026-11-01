const getSessionMock = vi.fn()
vi.mock('./auth', () => ({
  getAuth: () => ({ api: { getSession: getSessionMock } })
}))

const headersMock = vi.fn(async () => new Headers())
vi.mock('next/headers', () => ({ headers: () => headersMock() }))

const loggerErrorMock = vi.fn()
// getServerAuthSession only calls logger.error, so only that method is mocked.
vi.mock('@/lib/utils/logger', () => ({
  logger: { error: (...args: unknown[]) => loggerErrorMock(...args) }
}))

describe('getServerAuthSession', () => {
  beforeEach(() => {
    // Fresh module each test so React's cache() does not memoize across cases.
    vi.resetModules()
    getSessionMock.mockReset()
    loggerErrorMock.mockReset()
    headersMock.mockClear()
  })

  it('fails closed (logs + returns null) when session resolution throws', async () => {
    // Automatic set-auth-jwt signing is disabled, but adapter, database, or
    // other plugin hook errors can still reject auth.api.getSession.
    getSessionMock.mockRejectedValue(
      new Error('Session database lookup failed')
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
