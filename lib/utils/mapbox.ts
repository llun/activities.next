const MAPBOX_JS_SRC = 'https://api.mapbox.com/mapbox-gl-js/v3.18.1/mapbox-gl.js'
const MAPBOX_CSS_HREF =
  'https://api.mapbox.com/mapbox-gl-js/v3.18.1/mapbox-gl.css'

let mapboxModulePromise: Promise<unknown> | null = null

export const loadMapboxModule = async <T>(): Promise<T> => {
  if (typeof window === 'undefined') {
    throw new Error('Mapbox can only be loaded in a browser')
  }

  const globalWindow = window as Window & { mapboxgl?: T }
  if (globalWindow.mapboxgl) {
    return globalWindow.mapboxgl
  }

  if (!mapboxModulePromise) {
    mapboxModulePromise = new Promise<unknown>((resolve, reject) => {
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

      const resolveIfLoaded = () => {
        if (!globalWindow.mapboxgl) {
          return false
        }

        resolveOnce(globalWindow.mapboxgl)
        return true
      }

      const waitForMapboxGlobal = (timeoutMs = 5000) => {
        const startedAt = Date.now()

        const poll = () => {
          if (resolveIfLoaded()) {
            return
          }

          if (Date.now() - startedAt >= timeoutMs) {
            rejectOnce(new Error('Mapbox global was not initialized'))
            return
          }

          window.setTimeout(poll, 50)
        }

        poll()
      }

      if (!document.querySelector('[data-mapbox-gl-css="true"]')) {
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = MAPBOX_CSS_HREF
        link.setAttribute('data-mapbox-gl-css', 'true')
        document.head.appendChild(link)
      }

      const existingScript = document.querySelector<HTMLScriptElement>(
        '[data-mapbox-gl-script="true"]'
      )

      if (existingScript) {
        if (resolveIfLoaded()) {
          return
        }

        existingScript.addEventListener(
          'load',
          () => {
            if (!resolveIfLoaded()) {
              waitForMapboxGlobal()
            }
          },
          { once: true }
        )
        existingScript.addEventListener(
          'error',
          () => rejectOnce(new Error('Failed to load Mapbox script')),
          { once: true }
        )

        waitForMapboxGlobal()
        return
      }

      const script = document.createElement('script')
      script.src = MAPBOX_JS_SRC
      script.async = true
      script.setAttribute('data-mapbox-gl-script', 'true')
      script.addEventListener(
        'load',
        () => {
          if (!resolveIfLoaded()) {
            waitForMapboxGlobal()
          }
        },
        { once: true }
      )
      script.addEventListener(
        'error',
        () => rejectOnce(new Error('Failed to load Mapbox script')),
        { once: true }
      )

      document.head.appendChild(script)
    })
  }

  return mapboxModulePromise as Promise<T>
}
