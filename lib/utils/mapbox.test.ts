/**
 * @vitest-environment jsdom
 */
import type { loadMapboxModule as LoadMapboxModule } from './mapbox'

const SCRIPT_SELECTOR = '[data-mapbox-gl-script="true"]'
const CSS_SELECTOR = '[data-mapbox-gl-css="true"]'
const LOAD_TIMEOUT_MS = 15000

type MapboxWindow = Window & { mapboxgl?: unknown }

describe('loadMapboxModule', () => {
  let loadMapboxModule: typeof LoadMapboxModule
  const fakeMapbox = { Map: class {} }

  const scripts = () => document.querySelectorAll(SCRIPT_SELECTOR)
  const finishScript = (type: 'load' | 'error') =>
    document.querySelector(SCRIPT_SELECTOR)?.dispatchEvent(new Event(type))

  beforeEach(async () => {
    vi.useFakeTimers()
    // The loader keeps its in-flight promise at module level, so every test
    // gets a fresh copy of the module as well as a fresh document.
    vi.resetModules()
    ;({ loadMapboxModule } = await import('./mapbox'))
    document.head.innerHTML = ''
    delete (window as MapboxWindow).mapboxgl
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    delete (window as MapboxWindow).mapboxgl
  })

  it('rejects outside a browser', async () => {
    vi.stubGlobal('window', undefined)

    await expect(loadMapboxModule()).rejects.toThrow(
      'Mapbox can only be loaded in a browser'
    )
  })

  it('returns an already loaded global without adding any tags', async () => {
    ;(window as MapboxWindow).mapboxgl = fakeMapbox

    await expect(loadMapboxModule()).resolves.toBe(fakeMapbox)
    expect(scripts()).toHaveLength(0)
    expect(document.querySelector(CSS_SELECTOR)).toBeNull()
  })

  it('injects the pinned stylesheet and async script, then resolves with the global once the script loads', async () => {
    const pending = loadMapboxModule()

    const link = document.querySelector<HTMLLinkElement>(CSS_SELECTOR)
    expect(link?.rel).toBe('stylesheet')
    expect(link?.href).toBe(
      'https://api.mapbox.com/mapbox-gl-js/v3.18.1/mapbox-gl.css'
    )
    const script = document.querySelector<HTMLScriptElement>(SCRIPT_SELECTOR)
    expect(script?.src).toBe(
      'https://api.mapbox.com/mapbox-gl-js/v3.18.1/mapbox-gl.js'
    )
    expect(script?.async).toBe(true)

    ;(window as MapboxWindow).mapboxgl = fakeMapbox
    finishScript('load')

    await expect(pending).resolves.toBe(fakeMapbox)
  })

  it('shares one script between concurrent callers', async () => {
    const first = loadMapboxModule()
    const second = loadMapboxModule()

    expect(scripts()).toHaveLength(1)
    ;(window as MapboxWindow).mapboxgl = fakeMapbox
    finishScript('load')

    await expect(Promise.all([first, second])).resolves.toEqual([
      fakeMapbox,
      fakeMapbox
    ])
  })

  it('does not add a second stylesheet when one is already present', async () => {
    const link = document.createElement('link')
    link.setAttribute('data-mapbox-gl-css', 'true')
    document.head.appendChild(link)

    const pending = loadMapboxModule()
    ;(window as MapboxWindow).mapboxgl = fakeMapbox
    finishScript('load')
    await pending

    expect(document.querySelectorAll(CSS_SELECTOR)).toHaveLength(1)
  })

  it('waits for the global when the script has loaded but has not defined it yet', async () => {
    const pending = loadMapboxModule()
    finishScript('load')

    await vi.advanceTimersByTimeAsync(500)
    ;(window as MapboxWindow).mapboxgl = fakeMapbox
    await vi.advanceTimersByTimeAsync(50)

    await expect(pending).resolves.toBe(fakeMapbox)
  })

  it('rejects when the script loads but never defines the global within the timeout', async () => {
    const pending = loadMapboxModule()
    const outcome = pending.then(
      () => 'resolved',
      (error: Error) => error.message
    )
    finishScript('load')

    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS)

    await expect(outcome).resolves.toBe('Mapbox global was not initialized')
  })

  it('rejects when the script fails to load', async () => {
    const pending = loadMapboxModule()
    const outcome = expect(pending).rejects.toThrow(
      'Failed to load Mapbox script'
    )

    finishScript('error')

    await outcome
  })

  describe('with a script tag already on the page', () => {
    const addExistingScript = () => {
      const existing = document.createElement('script')
      existing.setAttribute('data-mapbox-gl-script', 'true')
      document.head.appendChild(existing)
      return existing
    }

    it('reuses it instead of adding another, resolving when it loads', async () => {
      const existing = addExistingScript()

      const pending = loadMapboxModule()
      expect(scripts()).toHaveLength(1)
      ;(window as MapboxWindow).mapboxgl = fakeMapbox
      existing.dispatchEvent(new Event('load'))

      await expect(pending).resolves.toBe(fakeMapbox)
    })

    it('rejects when the existing script reports an error', async () => {
      const existing = addExistingScript()

      const pending = loadMapboxModule()
      const outcome = expect(pending).rejects.toThrow(
        'Failed to load Mapbox script'
      )
      existing.dispatchEvent(new Event('error'))

      await outcome
    })

    it('resolves by polling when the existing script finished loading before the call', async () => {
      addExistingScript()

      const pending = loadMapboxModule()
      await vi.advanceTimersByTimeAsync(200)
      ;(window as MapboxWindow).mapboxgl = fakeMapbox
      await vi.advanceTimersByTimeAsync(50)

      await expect(pending).resolves.toBe(fakeMapbox)
    })
  })

  it('lets a later call retry after a failed load', async () => {
    const failed = loadMapboxModule()
    const failure = expect(failed).rejects.toThrow(
      'Failed to load Mapbox script'
    )
    finishScript('error')
    await failure

    const retry = loadMapboxModule()
    // The failed script tag stays on the page, so the retry attaches to it
    // rather than adding a second one.
    expect(scripts()).toHaveLength(1)
    ;(window as MapboxWindow).mapboxgl = fakeMapbox
    finishScript('load')

    await expect(retry).resolves.toBe(fakeMapbox)
  })
})
