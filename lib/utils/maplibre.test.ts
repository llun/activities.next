/**
 * @vitest-environment jsdom
 */

const removeInjected = () => {
  document
    .querySelectorAll('[data-maplibre-gl-script], [data-maplibre-gl-css]')
    .forEach((element) => element.remove())
}

describe('loadMaplibreModule', () => {
  beforeEach(() => {
    // Each test gets a fresh module instance (the loader memoizes its promise).
    vi.resetModules()
    removeInjected()
    delete (window as Window & { maplibregl?: unknown }).maplibregl
  })

  afterEach(() => {
    removeInjected()
    delete (window as Window & { maplibregl?: unknown }).maplibregl
  })

  it('resolves with the existing global when MapLibre is already present', async () => {
    const fake = { Map: class {} }
    ;(window as Window & { maplibregl?: unknown }).maplibregl = fake

    const { loadMaplibreModule } = await import('@/lib/utils/maplibre')
    await expect(loadMaplibreModule()).resolves.toBe(fake)
    // No script/style injected when the global is already available.
    expect(
      document.querySelector('[data-maplibre-gl-script="true"]')
    ).toBeNull()
  })

  it('injects the script and stylesheet once with SRI and resolves on load', async () => {
    const { loadMaplibreModule } = await import('@/lib/utils/maplibre')
    const promise = loadMaplibreModule()

    const script = document.querySelector<HTMLScriptElement>(
      '[data-maplibre-gl-script="true"]'
    )
    const link = document.querySelector<HTMLLinkElement>(
      '[data-maplibre-gl-css="true"]'
    )
    expect(script).not.toBeNull()
    expect(link).not.toBeNull()
    expect(script?.getAttribute('integrity')).toMatch(/^sha384-/)
    expect(script?.getAttribute('crossorigin')).toBe('anonymous')
    expect(link?.getAttribute('integrity')).toMatch(/^sha384-/)
    expect(link?.getAttribute('crossorigin')).toBe('anonymous')

    const fake = { Map: class {} }
    ;(window as Window & { maplibregl?: unknown }).maplibregl = fake
    script?.dispatchEvent(new Event('load'))

    await expect(promise).resolves.toBe(fake)
    // Idempotent: a single script tag even after the resolve.
    expect(
      document.querySelectorAll('[data-maplibre-gl-script="true"]')
    ).toHaveLength(1)
  })

  it('rejects when the script fails to load', async () => {
    const { loadMaplibreModule } = await import('@/lib/utils/maplibre')
    const promise = loadMaplibreModule()

    const script = document.querySelector<HTMLScriptElement>(
      '[data-maplibre-gl-script="true"]'
    )
    script?.dispatchEvent(new Event('error'))

    await expect(promise).rejects.toThrow(/MapLibre/)
    // The failed tags are removed so a later retry can inject fresh ones.
    expect(
      document.querySelector('[data-maplibre-gl-script="true"]')
    ).toBeNull()
    expect(document.querySelector('[data-maplibre-gl-css="true"]')).toBeNull()
  })

  it('keeps the loaded tags when only the global init times out', async () => {
    vi.useFakeTimers()
    try {
      const { loadMaplibreModule } = await import('@/lib/utils/maplibre')
      const promise = loadMaplibreModule()
      // Avoid an unhandled rejection while advancing timers.
      promise.catch(() => {})

      const script = document.querySelector<HTMLScriptElement>(
        '[data-maplibre-gl-script="true"]'
      )
      // The script resource loads fine, but window.maplibregl never appears.
      script?.dispatchEvent(new Event('load'))
      await vi.advanceTimersByTimeAsync(16000)

      await expect(promise).rejects.toThrow(/not initialized/i)
      // A timeout must NOT tear out the successfully-loaded script/stylesheet —
      // only a genuine resource 'error' does — so a later retry keeps its styles.
      expect(
        document.querySelector('[data-maplibre-gl-script="true"]')
      ).not.toBeNull()
      expect(
        document.querySelector('[data-maplibre-gl-css="true"]')
      ).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('exposes the keyless OpenFreeMap style URL', async () => {
    const { OPENFREEMAP_STYLE_URL } = await import('@/lib/utils/maplibre')
    expect(OPENFREEMAP_STYLE_URL).toMatch(
      /^https:\/\/tiles\.openfreemap\.org\//
    )
  })

  it('exposes a light OpenFreeMap style URL for the route heatmap', async () => {
    const { OPENFREEMAP_HEATMAP_STYLE_URL } =
      await import('@/lib/utils/maplibre')
    // Same origin as the bright style (no extra CSP allowance) but the light
    // "positron" basemap, so coloured routes stay legible.
    expect(OPENFREEMAP_HEATMAP_STYLE_URL).toBe(
      'https://tiles.openfreemap.org/styles/positron'
    )
  })
})
