/**
 * @vitest-environment jsdom
 */

vi.mock('@/lib/client', () => ({
  getAppleMapsToken: vi.fn()
}))

const MAPKIT_SCRIPT_SELECTOR = '[data-apple-mapkit-script="true"]'
const MAPKIT_CALLBACK_NAME = '__activitiesNextInitMapKit'

type TestWindow = Window & {
  mapkit?: unknown
  __activitiesNextInitMapKit?: () => void
}

type AuthorizationCallback = (done: (token: string) => void) => void

const testWindow = () => window as TestWindow

const removeInjected = () => {
  document
    .querySelectorAll('[data-apple-mapkit-script]')
    .forEach((element) => element.remove())
}

const cleanup = () => {
  removeInjected()
  delete testWindow().mapkit
  delete testWindow()[MAPKIT_CALLBACK_NAME]
}

const currentScript = () =>
  document.querySelector<HTMLScriptElement>(MAPKIT_SCRIPT_SELECTOR)

const clientMock = () =>
  vi.importMock<typeof import('@/lib/client')>('@/lib/client')

const authorizationCallbackOf = (init: ReturnType<typeof vi.fn>) =>
  (init.mock.calls[0][0] as { authorizationCallback: AuthorizationCallback })
    .authorizationCallback

type MapKitEvent = { status?: string }
type MapKitEventListener = (event: MapKitEvent) => void

/**
 * A stand-in for the `mapkit` global. `Map` must exist: the loader treats a
 * library constructor as proof the `data-libraries` finished loading. The
 * namespace is an event emitter — MapKit reports the authorization outcome
 * through `configuration-change` / `error` events, not through `init()`.
 */
const fakeMapKit = () => {
  const listeners = new Map<string, MapKitEventListener[]>()

  return {
    init: vi.fn(),
    Map: class {},
    addEventListener: vi.fn((type: string, listener: MapKitEventListener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener])
    }),
    removeEventListener: vi.fn(
      (type: string, listener: MapKitEventListener) => {
        listeners.set(
          type,
          (listeners.get(type) ?? []).filter((entry) => entry !== listener)
        )
      }
    ),
    emit: (type: string, event: MapKitEvent = {}) => {
      ;[...(listeners.get(type) ?? [])].forEach((listener) => listener(event))
    },
    listenerCount: (type: string) => (listeners.get(type) ?? []).length
  }
}

/** Mimics mapkit.core.js publishing its global part-way through bootstrap. */
const publishGlobal = () => {
  const fake = fakeMapKit()
  testWindow().mapkit = fake
  return fake
}

/** Mimics Apple invoking the script's `data-callback` once the SDK is ready. */
const invokeReadyCallback = () => {
  const callback = testWindow()[MAPKIT_CALLBACK_NAME]
  expect(typeof callback).toBe('function')
  callback?.()
}

/** The ready callback plus the first successful authorization. */
const completeBootstrap = (fake: ReturnType<typeof fakeMapKit>) => {
  invokeReadyCallback()
  fake.emit('configuration-change', { status: 'Initialized' })
}

const PENDING = Symbol('pending')

/** Resolves to PENDING when `promise` has not settled within a short window. */
const settledOrPending = (promise: Promise<unknown>) =>
  Promise.race([
    promise.then(
      () => 'settled',
      () => 'settled'
    ),
    new Promise((resolve) => setTimeout(() => resolve(PENDING), 20))
  ])

describe('loadMapKitModule', () => {
  beforeEach(() => {
    // Each test gets a fresh module instance (the loader memoizes its promise).
    vi.resetModules()
    // The mocked @/lib/client instance survives resetModules, so clear its calls.
    vi.resetAllMocks()
    cleanup()
  })

  afterEach(() => {
    cleanup()
  })

  it('throws when loaded outside a browser', async () => {
    vi.stubGlobal('window', undefined)
    try {
      const { loadMapKitModule } = await import('@/lib/utils/mapkit')
      await expect(loadMapKitModule()).rejects.toThrow(/browser/i)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('does not resolve on a bare script load before the ready callback fires', async () => {
    const { loadMapKitModule } = await import('@/lib/utils/mapkit')
    const promise = loadMapKitModule()
    promise.catch(() => {})

    // mapkit.core.js assigns window.mapkit while it is still executing, then the
    // resource fires 'load' — neither means the libraries loaded or init() ran.
    const fake = publishGlobal()
    currentScript()?.dispatchEvent(new Event('load'))

    await expect(settledOrPending(promise)).resolves.toBe(PENDING)
    expect(fake.init).not.toHaveBeenCalled()

    // The ready callback alone is not readiness either: it only registers the
    // namespace listeners and calls init(), whose authorization may still fail.
    invokeReadyCallback()
    expect(fake.init).toHaveBeenCalledTimes(1)
    await expect(settledOrPending(promise)).resolves.toBe(PENDING)

    // Only a successful authorization settles the loader.
    fake.emit('configuration-change', { status: 'Initialized' })
    await expect(promise).resolves.toBe(fake)
  })

  it('injects the pinned MapKit script exactly once and resolves only once MapKit authorizes', async () => {
    const { loadMapKitModule } = await import('@/lib/utils/mapkit')
    const first = loadMapKitModule()
    const second = loadMapKitModule()

    // Concurrent loads share the singleton promise and a single script tag.
    expect(document.querySelectorAll(MAPKIT_SCRIPT_SELECTOR)).toHaveLength(1)

    const script = currentScript()
    expect(script?.src).toMatch(
      /^https:\/\/cdn\.apple-mapkit\.com\/mk\/\d+\.\d+\.\d+\/mapkit\.core\.js$/
    )
    expect(script?.async).toBe(true)
    expect(script?.getAttribute('crossorigin')).toBe('anonymous')
    expect(script?.getAttribute('data-libraries')).toBe(
      'map,overlays,annotations'
    )
    expect(script?.getAttribute('data-callback')).toBe(MAPKIT_CALLBACK_NAME)
    // Apple publishes no SRI hashes for mapkit.core.js.
    expect(script?.getAttribute('integrity')).toBeNull()

    const fake = publishGlobal()
    script?.dispatchEvent(new Event('load'))

    // A late consumer arriving mid-bootstrap must await the same promise rather
    // than short-circuiting on the half-initialised global.
    const third = loadMapKitModule()
    third.catch(() => {})
    await expect(settledOrPending(third)).resolves.toBe(PENDING)
    expect(document.querySelectorAll(MAPKIT_SCRIPT_SELECTOR)).toHaveLength(1)

    completeBootstrap(fake)

    expect(fake.init).toHaveBeenCalledTimes(1)
    expect(fake.init.mock.calls[0][0]).toHaveProperty(
      'authorizationCallback',
      expect.any(Function)
    )
    await expect(first).resolves.toBe(fake)
    await expect(second).resolves.toBe(fake)
    await expect(third).resolves.toBe(fake)
    expect(document.querySelectorAll(MAPKIT_SCRIPT_SELECTOR)).toHaveLength(1)
  })

  it('resolves immediately once a previous load initialized MapKit', async () => {
    const { loadMapKitModule } = await import('@/lib/utils/mapkit')
    const promise = loadMapKitModule()
    const fake = publishGlobal()
    completeBootstrap(fake)
    await expect(promise).resolves.toBe(fake)

    await expect(loadMapKitModule()).resolves.toBe(fake)
    expect(fake.init).toHaveBeenCalledTimes(1)
    expect(document.querySelectorAll(MAPKIT_SCRIPT_SELECTOR)).toHaveLength(1)
  })

  it('rejects and removes the script tag when the script fails to load', async () => {
    const { loadMapKitModule } = await import('@/lib/utils/mapkit')
    const promise = loadMapKitModule()

    currentScript()?.dispatchEvent(new Event('error'))

    await expect(promise).rejects.toThrow(/MapKit/)
    expect(currentScript()).toBeNull()
  })

  it('injects a fresh script tag when a load is retried after a failure', async () => {
    const { loadMapKitModule } = await import('@/lib/utils/mapkit')
    const failing = loadMapKitModule()
    currentScript()?.dispatchEvent(new Event('error'))
    await expect(failing).rejects.toThrow(/MapKit/)

    const retried = loadMapKitModule()
    const script = currentScript()
    expect(script).not.toBeNull()
    expect(document.querySelectorAll(MAPKIT_SCRIPT_SELECTOR)).toHaveLength(1)

    const fake = publishGlobal()
    completeBootstrap(fake)
    await expect(retried).resolves.toBe(fake)
  })

  it('rejects when the ready callback never fires', async () => {
    vi.useFakeTimers()
    try {
      const { loadMapKitModule } = await import('@/lib/utils/mapkit')
      const promise = loadMapKitModule()
      // Avoid an unhandled rejection while advancing timers.
      promise.catch(() => {})

      // The script resource loads fine and even publishes its global, but Apple
      // never invokes the data-callback, so the SDK is never usable.
      publishGlobal()
      currentScript()?.dispatchEvent(new Event('load'))
      await vi.advanceTimersByTimeAsync(16000)

      await expect(promise).rejects.toThrow(/not initialized/i)
      // A timeout must not tear out a successfully-loaded script tag.
      expect(currentScript()).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('initializes MapKit with an authorization callback that forwards the fetched token', async () => {
    const { getAppleMapsToken } = await clientMock()
    vi.mocked(getAppleMapsToken).mockResolvedValue('apple-token')

    const { loadMapKitModule } = await import('@/lib/utils/mapkit')
    const promise = loadMapKitModule()

    const fake = publishGlobal()
    completeBootstrap(fake)

    expect(fake.init).toHaveBeenCalledTimes(1)
    const authorizationCallback = authorizationCallbackOf(fake.init)

    const done = vi.fn()
    authorizationCallback(done)
    await vi.waitFor(() => expect(done).toHaveBeenCalledWith('apple-token'))
    expect(getAppleMapsToken).toHaveBeenCalledTimes(1)

    await expect(promise).resolves.toBe(fake)
  })

  it('rejects and never calls done when no Apple Maps token can be fetched', async () => {
    vi.useFakeTimers()
    try {
      const { getAppleMapsToken } = await clientMock()
      vi.mocked(getAppleMapsToken).mockResolvedValue(null)

      const { loadMapKitModule } = await import('@/lib/utils/mapkit')
      const promise = loadMapKitModule()
      promise.catch(() => {})

      const fake = publishGlobal()
      invokeReadyCallback()

      const done = vi.fn()
      authorizationCallbackOf(fake.init)(done)

      // Three attempts, each separated by the retry backoff.
      await vi.advanceTimersByTimeAsync(2000)
      expect(getAppleMapsToken).toHaveBeenCalledTimes(3)
      expect(done).not.toHaveBeenCalled()

      // A map that can never authorize must fail the loader instead of hanging
      // until the watchdog and leaving a permanently blank surface.
      await expect(promise).rejects.toThrow(
        /no Apple Maps authorization token/i
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('authorizes after a transient token fetch failure', async () => {
    vi.useFakeTimers()
    try {
      const { getAppleMapsToken } = await clientMock()
      vi.mocked(getAppleMapsToken)
        .mockResolvedValueOnce(null)
        .mockResolvedValue('apple-token')

      const { loadMapKitModule } = await import('@/lib/utils/mapkit')
      const promise = loadMapKitModule()
      promise.catch(() => {})

      const fake = publishGlobal()
      invokeReadyCallback()

      const done = vi.fn()
      authorizationCallbackOf(fake.init)(done)

      await vi.advanceTimersByTimeAsync(300)
      expect(getAppleMapsToken).toHaveBeenCalledTimes(2)
      expect(done).toHaveBeenCalledWith('apple-token')

      fake.emit('configuration-change', { status: 'Initialized' })
      await expect(promise).resolves.toBe(fake)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects when MapKit reports an authorization error', async () => {
    const { getAppleMapsToken } = await clientMock()
    vi.mocked(getAppleMapsToken).mockResolvedValue('rejected-token')

    const { loadMapKitModule } = await import('@/lib/utils/mapkit')
    const promise = loadMapKitModule()

    const fake = publishGlobal()
    invokeReadyCallback()

    // Apple accepts `done` and only later rejects the token: MapKit surfaces that
    // asynchronously as a namespace 'error' event.
    fake.emit('error', { status: 'Unauthorized' })

    await expect(promise).rejects.toThrow(/Unauthorized/)
    // The namespace listeners are detached once the loader settles.
    expect(fake.listenerCount('error')).toBe(0)
    expect(fake.listenerCount('configuration-change')).toBe(0)
  })

  it('keeps the authorization callback re-runnable for token refreshes', async () => {
    const { getAppleMapsToken } = await clientMock()
    vi.mocked(getAppleMapsToken).mockResolvedValue('apple-token')

    const { loadMapKitModule } = await import('@/lib/utils/mapkit')
    const promise = loadMapKitModule()

    const fake = publishGlobal()
    completeBootstrap(fake)
    await expect(promise).resolves.toBe(fake)

    // MapKit re-invokes the callback when the token expires; each call fetches a
    // fresh short-lived token rather than replaying a cached one.
    vi.mocked(getAppleMapsToken).mockResolvedValue('refreshed-token')
    const done = vi.fn()
    authorizationCallbackOf(fake.init)(done)
    await vi.waitFor(() => expect(done).toHaveBeenCalledWith('refreshed-token'))
  })
})
