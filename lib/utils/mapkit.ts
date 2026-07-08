import { getAppleMapsToken } from '@/lib/client'

// Apple MapKit JS loader for the Apple fitness map provider.
//
// Mirrors lib/utils/maplibre.ts and lib/utils/mapbox.ts: a singleton promise that
// injects Apple's CDN script once, waits for the `mapkit` global, and resolves it
// so callers can render maps without bundling the SDK.
//
// MAPKIT_VERSION is a deliberately pinned exact version — bump it consciously
// rather than tracking Apple's floating `6.x.x` alias. Unlike the MapLibre bundle
// there is no Subresource Integrity hash here: Apple publishes NO SRI hashes for
// `mapkit.core.js` (and the file behind a version URL can be re-published), so an
// `integrity` attribute cannot be maintained. The Mapbox GL loader is likewise
// SRI-less today. Pinning the version plus the `https://cdn.apple-mapkit.com`
// CSP allowance in lib/utils/http-headers/csp.ts is the protection we have.
const MAPKIT_VERSION = '6.0.114'
const MAPKIT_JS_SRC = `https://cdn.apple-mapkit.com/mk/${MAPKIT_VERSION}/mapkit.core.js`
// MapKit JS v5+ splits the SDK into libraries loaded on demand; the map itself
// plus the overlays/annotations we draw routes and markers with.
const MAPKIT_LIBRARIES = 'map,overlays,annotations'
const MAPKIT_LOAD_TIMEOUT_MS = 15000
const MAPKIT_SCRIPT_SELECTOR = '[data-apple-mapkit-script="true"]'
// MapKit calls this global once the SDK is parsed and ready for `mapkit.init`.
const MAPKIT_CALLBACK_NAME = '__activitiesNextInitMapKit'

type MapKitTokenCallback = (token: string) => void

/**
 * Minimal structural view of the `mapkit` global — only the pieces this app uses.
 * The loader is generic (`loadMapKitModule<T>`) exactly like the GL loaders, so
 * callers can supply a richer type when they have one.
 */
export interface MapKitModule {
  init(options: {
    authorizationCallback: (done: MapKitTokenCallback) => void
  }): void
  Map: new (element: Element | string, options?: unknown) => unknown
  Style: new (options?: unknown) => unknown
  PolylineOverlay: new (points: unknown[], options?: unknown) => unknown
  PolygonOverlay: new (points: unknown[], options?: unknown) => unknown
  CircleOverlay: new (
    coordinate: unknown,
    radius: number,
    options?: unknown
  ) => unknown
  MarkerAnnotation: new (coordinate: unknown, options?: unknown) => unknown
  CoordinateRegion: new (center: unknown, span: unknown) => unknown
  CoordinateSpan: new (
    latitudeDelta: number,
    longitudeDelta?: number
  ) => unknown
  Coordinate: new (latitude: number, longitude: number) => unknown
  BoundingRegion: new (
    northLatitude: number,
    eastLongitude: number,
    southLatitude: number,
    westLongitude: number
  ) => unknown
}

type MapKitWindow = Window & {
  mapkit?: MapKitModule
  [MAPKIT_CALLBACK_NAME]?: () => void
}

let mapkitModulePromise: Promise<unknown> | null = null

/**
 * MapKit re-invokes `authorizationCallback` whenever the token expires, so this
 * must stay side-effect free and re-runnable: always request a fresh short-lived
 * token, never cache or short-circuit. A missing token (provider not configured)
 * simply never calls `done`, and MapKit stays unauthorized so the caller can fall
 * back to another provider.
 */
const initializeMapKit = (mapkit: MapKitModule) => {
  mapkit.init({
    authorizationCallback: (done) => {
      void getAppleMapsToken().then((token) => {
        if (token) {
          done(token)
        }
      })
    }
  })
}

export const loadMapKitModule = async <T = MapKitModule>(): Promise<T> => {
  if (typeof window === 'undefined') {
    throw new Error('MapKit can only be loaded in a browser')
  }

  const globalWindow = window as MapKitWindow
  if (globalWindow.mapkit) {
    return globalWindow.mapkit as T
  }

  if (!mapkitModulePromise) {
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

      // Remove the failed <script> so a later retry injects a fresh tag. A script
      // element that already fired 'error' never fires 'load' again, so leaving it
      // would make every retry hang until the poll times out. Only run this on a
      // genuine resource 'error' — NOT on the global-init timeout, where the
      // script itself loaded fine.
      const removeInjectedTags = () => {
        document.querySelector(MAPKIT_SCRIPT_SELECTOR)?.remove()
      }

      const onScriptError = () => {
        removeInjectedTags()
        rejectOnce(new Error('Failed to load MapKit script'))
      }

      const resolveIfLoaded = () => {
        if (!globalWindow.mapkit) {
          return false
        }

        resolveOnce(globalWindow.mapkit)
        return true
      }

      const waitForMapKitGlobal = (timeoutMs = MAPKIT_LOAD_TIMEOUT_MS) => {
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
            rejectOnce(new Error('MapKit global was not initialized'))
            return
          }

          window.setTimeout(poll, 50)
        }

        poll()
      }

      // Registered before the script is injected: MapKit reads `data-callback` off
      // the script tag and invokes this global as soon as the SDK is ready.
      globalWindow[MAPKIT_CALLBACK_NAME] = () => {
        const mapkit = globalWindow.mapkit
        if (!mapkit) {
          return
        }

        initializeMapKit(mapkit)
        resolveOnce(mapkit)
      }

      const existingScript = document.querySelector<HTMLScriptElement>(
        MAPKIT_SCRIPT_SELECTOR
      )

      if (existingScript) {
        if (resolveIfLoaded()) {
          return
        }

        existingScript.addEventListener(
          'load',
          () => {
            if (!resolveIfLoaded()) {
              waitForMapKitGlobal()
            }
          },
          { once: true }
        )
        existingScript.addEventListener('error', onScriptError, { once: true })

        waitForMapKitGlobal()
        return
      }

      const script = document.createElement('script')
      script.src = MAPKIT_JS_SRC
      script.async = true
      script.setAttribute('crossorigin', 'anonymous')
      script.setAttribute('data-libraries', MAPKIT_LIBRARIES)
      script.setAttribute('data-callback', MAPKIT_CALLBACK_NAME)
      script.setAttribute('data-apple-mapkit-script', 'true')
      script.addEventListener(
        'load',
        () => {
          if (!resolveIfLoaded()) {
            waitForMapKitGlobal()
          }
        },
        { once: true }
      )
      script.addEventListener('error', onScriptError, { once: true })

      document.head.appendChild(script)
    })

    mapkitModulePromise = loadPromise.catch((error) => {
      mapkitModulePromise = null
      throw error
    })
  }

  return mapkitModulePromise as Promise<T>
}
