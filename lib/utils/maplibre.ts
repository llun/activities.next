// MapLibre GL JS loader for the keyless, free map provider.
//
// Mirrors lib/utils/mapbox.ts but loads the open-source MapLibre GL build from a
// pinned CDN and renders OpenFreeMap's keyless vector tiles. Used by the heatmap
// region picker when no Mapbox access token is configured, so the picker still
// shows a real interactive map without any API key.
//
// The matching Content-Security-Policy allowances (the jsDelivr script/style
// origin and the OpenFreeMap tile origin) live in lib/utils/http-headers/csp.ts
// and are only emitted when no Mapbox token is configured.
const MAPLIBRE_VERSION = '4.7.1'
const MAPLIBRE_JS_SRC = `https://cdn.jsdelivr.net/npm/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js`
const MAPLIBRE_CSS_HREF = `https://cdn.jsdelivr.net/npm/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`
// Subresource Integrity for the pinned ${MAPLIBRE_VERSION} bundle. Because the
// script/style load from a shared, general-purpose CDN, SRI makes a tampered or
// swapped asset fail closed (and the picker falls back to the coordinate
// fields). Regenerate these hashes whenever MAPLIBRE_VERSION changes:
//   curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A
const MAPLIBRE_JS_INTEGRITY =
  'sha384-SYKAG6cglRMN0RVvhNeBY0r3FYKNOJtznwA0v7B5Vp9tr31xAHsZC0DqkQ/pZDmj'
const MAPLIBRE_CSS_INTEGRITY =
  'sha384-MinO0mNliZ3vwppuPOUnGa+iq619pfMhLVUXfC4LHwSCvF9H+6P/KO4Q7qBOYV5V'
const MAPLIBRE_LOAD_TIMEOUT_MS = 15000

/** Keyless OpenFreeMap vector style (OpenStreetMap data, public tiles). */
export const OPENFREEMAP_STYLE_URL =
  'https://tiles.openfreemap.org/styles/bright'

/**
 * Keyless OpenFreeMap light style for the route heatmap result map. The light,
 * low-saturation "positron" basemap keeps the coloured route overlay legible —
 * the colourful "bright" style used by the region picker washes the lines out.
 * Served from the same `tiles.openfreemap.org` origin, so it needs no extra CSP
 * allowance.
 */
export const OPENFREEMAP_HEATMAP_STYLE_URL =
  'https://tiles.openfreemap.org/styles/positron'

let maplibreModulePromise: Promise<unknown> | null = null

export const loadMaplibreModule = async <T>(): Promise<T> => {
  if (typeof window === 'undefined') {
    throw new Error('MapLibre can only be loaded in a browser')
  }

  const globalWindow = window as Window & { maplibregl?: T }
  if (globalWindow.maplibregl) {
    return globalWindow.maplibregl
  }

  if (!maplibreModulePromise) {
    const loadPromise = new Promise<unknown>((resolve, reject) => {
      let settled = false

      const resolveOnce = (value: unknown) => {
        if (settled) {
          return
        }

        settled = true
        resolve(value)
      }

      const rejectOnce = (error: Error) => {
        if (settled) {
          return
        }

        settled = true
        reject(error)
      }

      // Remove the failed <script>/<link> so a later retry injects fresh tags. A
      // script element that already fired 'error' will not fire 'load' again, so
      // leaving it would make every retry hang until the poll times out. Only run
      // this on a genuine resource 'error' — NOT on the global-init timeout, where
      // the assets loaded fine and tearing out a good stylesheet would leave a
      // later retry (which may find the global already present) unstyled.
      const removeInjectedTags = () => {
        document.querySelector('[data-maplibre-gl-script="true"]')?.remove()
        document.querySelector('[data-maplibre-gl-css="true"]')?.remove()
      }

      const onScriptError = () => {
        removeInjectedTags()
        rejectOnce(new Error('Failed to load MapLibre script'))
      }

      const resolveIfLoaded = () => {
        if (!globalWindow.maplibregl) {
          return false
        }

        resolveOnce(globalWindow.maplibregl)
        return true
      }

      const waitForMaplibreGlobal = (timeoutMs = MAPLIBRE_LOAD_TIMEOUT_MS) => {
        const startedAt = Date.now()

        const poll = () => {
          // Stop polling once the promise is settled (e.g. the script fired
          // 'error' and rejected) so we don't keep scheduling timers until the
          // timeout elapses.
          if (settled) {
            return
          }

          if (resolveIfLoaded()) {
            return
          }

          if (Date.now() - startedAt >= timeoutMs) {
            rejectOnce(new Error('MapLibre global was not initialized'))
            return
          }

          window.setTimeout(poll, 50)
        }

        poll()
      }

      if (!document.querySelector('[data-maplibre-gl-css="true"]')) {
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = MAPLIBRE_CSS_HREF
        link.setAttribute('integrity', MAPLIBRE_CSS_INTEGRITY)
        link.setAttribute('crossorigin', 'anonymous')
        link.setAttribute('data-maplibre-gl-css', 'true')
        document.head.appendChild(link)
      }

      const existingScript = document.querySelector<HTMLScriptElement>(
        '[data-maplibre-gl-script="true"]'
      )

      if (existingScript) {
        if (resolveIfLoaded()) {
          return
        }

        existingScript.addEventListener(
          'load',
          () => {
            if (!resolveIfLoaded()) {
              waitForMaplibreGlobal()
            }
          },
          { once: true }
        )
        existingScript.addEventListener('error', onScriptError, { once: true })

        waitForMaplibreGlobal()
        return
      }

      const script = document.createElement('script')
      script.src = MAPLIBRE_JS_SRC
      script.async = true
      script.setAttribute('integrity', MAPLIBRE_JS_INTEGRITY)
      script.setAttribute('crossorigin', 'anonymous')
      script.setAttribute('data-maplibre-gl-script', 'true')
      script.addEventListener(
        'load',
        () => {
          if (!resolveIfLoaded()) {
            waitForMaplibreGlobal()
          }
        },
        { once: true }
      )
      script.addEventListener('error', onScriptError, { once: true })

      document.head.appendChild(script)
    })

    maplibreModulePromise = loadPromise.catch((error) => {
      maplibreModulePromise = null
      throw error
    })
  }

  return maplibreModulePromise as Promise<T>
}
