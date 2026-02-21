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
      const onLoaded = () => {
        if (globalWindow.mapboxgl) {
          resolve(globalWindow.mapboxgl)
          return
        }

        reject(new Error('Mapbox global was not initialized'))
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
        if (globalWindow.mapboxgl) {
          resolve(globalWindow.mapboxgl)
          return
        }

        existingScript.addEventListener('load', onLoaded, { once: true })
        existingScript.addEventListener(
          'error',
          () => reject(new Error('Failed to load Mapbox script')),
          { once: true }
        )
        return
      }

      const script = document.createElement('script')
      script.src = MAPBOX_JS_SRC
      script.async = true
      script.setAttribute('data-mapbox-gl-script', 'true')
      script.addEventListener('load', onLoaded, { once: true })
      script.addEventListener(
        'error',
        () => reject(new Error('Failed to load Mapbox script')),
        { once: true }
      )

      document.head.appendChild(script)
    })
  }

  return mapboxModulePromise as Promise<T>
}
