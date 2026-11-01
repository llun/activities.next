/**
 * @vitest-environment jsdom
 */
import {
  CHUNK_RELOAD_KEY,
  handleBoundaryError,
  isChunkLoadError,
  reloadOnceAfterChunkError
} from './chunkLoadRecovery'
import * as clientErrorsModule from './clientErrors'

describe('isChunkLoadError', () => {
  it.each([
    {
      description: 'error with ChunkLoadError name',
      input: Object.assign(new Error('chunk failed'), {
        name: 'ChunkLoadError'
      }),
      expected: true
    },
    {
      description: 'Loading chunk failed message',
      input: new Error('Loading chunk 123 failed.'),
      expected: true
    },
    {
      description: 'Loading CSS chunk failed message',
      input: new Error('Loading CSS chunk app_layout_css failed.'),
      expected: true
    },
    {
      description: 'Failed to fetch dynamically imported module message',
      input: new Error(
        'Failed to fetch dynamically imported module: https://example.com/chunk.js'
      ),
      expected: true
    },
    {
      description: 'error loading dynamically imported module message',
      input: new Error('An error loading dynamically imported module occurred'),
      expected: true
    },
    {
      description: 'Importing a module script failed message',
      input: new Error('Importing a module script failed.'),
      expected: true
    },
    {
      description: 'raw string with chunk error text',
      input: 'Loading chunk 999 failed',
      expected: true
    },
    {
      description: 'TypeError unrelated to chunk loading',
      input: new TypeError('Cannot read properties of undefined (reading "x")'),
      expected: false
    },
    {
      description: 'plain generic Error',
      input: new Error('Database connection failed'),
      expected: false
    },
    {
      description: 'null value',
      input: null,
      expected: false
    },
    {
      description: 'undefined value',
      input: undefined,
      expected: false
    }
  ])('returns $expected for $description', ({ input, expected }) => {
    expect(isChunkLoadError(input)).toBe(expected)
  })
})

describe('reloadOnceAfterChunkError', () => {
  const originalLocation = window.location
  let reloadMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    sessionStorage.clear()
    reloadMock = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload: reloadMock }
    })
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation
    })
  })

  it('reloads the window and records the timestamp on the first chunk error', async () => {
    const before = Date.now()
    await reloadOnceAfterChunkError()

    expect(reloadMock).toHaveBeenCalledTimes(1)
    const stored = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY))
    expect(stored).toBeGreaterThanOrEqual(before)
  })

  it('does not reload a second time inside 5 minutes', async () => {
    const fourMinutesAgo = Date.now() - 4 * 60 * 1000
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(fourMinutesAgo))

    await reloadOnceAfterChunkError()
    expect(reloadMock).not.toHaveBeenCalled()
  })

  it('reloads again after 5 minutes have elapsed', async () => {
    const sixMinutesAgo = Date.now() - 6 * 60 * 1000
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(sixMinutesAgo))

    await reloadOnceAfterChunkError()
    expect(reloadMock).toHaveBeenCalledTimes(1)
    expect(Number(sessionStorage.getItem(CHUNK_RELOAD_KEY))).toBeGreaterThan(
      sixMinutesAgo
    )
  })

  it('does not reload when the browser is offline (navigator.onLine === false)', async () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false
    })

    await reloadOnceAfterChunkError()
    expect(reloadMock).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(CHUNK_RELOAD_KEY)).toBeNull()
  })

  it('does not reload when sessionStorage access throws (loop guard lost)', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: The operation is insecure.')
    })

    await reloadOnceAfterChunkError()
    expect(reloadMock).not.toHaveBeenCalled()
  })

  it('proceeds with reload when a hung service worker registration.update() times out', async () => {
    vi.useFakeTimers()

    const hungUpdate = new Promise<void>(() => {
      // Intentionally never resolves
    })
    const mockRegistration = {
      update: vi.fn(() => hungUpdate)
    }

    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistration: vi.fn().mockResolvedValue(mockRegistration)
      }
    })

    const reloadPromise = reloadOnceAfterChunkError()

    // Advance 999ms: timeout has not triggered
    await vi.advanceTimersByTimeAsync(999)
    expect(reloadMock).not.toHaveBeenCalled()

    // Advance 1 more ms to reach the 1000ms timeout
    await vi.advanceTimersByTimeAsync(1)
    await reloadPromise

    expect(reloadMock).toHaveBeenCalledTimes(1)
  })

  it('proceeds with reload when navigator.serviceWorker is missing', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: undefined
    })

    await reloadOnceAfterChunkError()
    expect(reloadMock).toHaveBeenCalledTimes(1)
  })
})

describe('handleBoundaryError', () => {
  let reportSpy: ReturnType<typeof vi.spyOn>
  const originalLocation = window.location
  let reloadMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    sessionStorage.clear()
    reloadMock = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload: reloadMock }
    })
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true
    })
    reportSpy = vi
      .spyOn(clientErrorsModule, 'reportClientError')
      .mockImplementation(() => {})
  })

  afterEach(() => {
    reportSpy.mockRestore()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation
    })
  })

  it('reports chunk errors with source chunk-load and triggers reload', async () => {
    const chunkErr = new Error('Loading chunk 42 failed')

    handleBoundaryError(chunkErr, 'error')

    expect(reportSpy).toHaveBeenCalledWith(chunkErr, 'chunk-load')
    // Wait for microtask tick for async reloadOnceAfterChunkError
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(reloadMock).toHaveBeenCalledTimes(1)
  })

  it('reports standard errors with the boundary source and does not reload', async () => {
    const genericErr = new Error('Normal app error')

    handleBoundaryError(genericErr, 'global-error')

    expect(reportSpy).toHaveBeenCalledWith(genericErr, 'global-error')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(reloadMock).not.toHaveBeenCalled()
  })
})
