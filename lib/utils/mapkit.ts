import { getAppleMapsToken } from '@/lib/client'

// Apple MapKit JS loader for the Apple fitness map provider.
//
// Mirrors lib/utils/maplibre.ts and lib/utils/mapbox.ts: a singleton promise that
// injects Apple's CDN script once and resolves the `mapkit` global so callers can
// render maps without bundling the SDK.
//
// READINESS CONTRACT — the `data-callback` is the ONLY resolve path.
// `mapkit.core.js` assigns `window.mapkit` synchronously while it is still
// executing, long before the `data-libraries` (map, overlays, annotations) have
// loaded and before anyone has called `mapkit.init()`. So the presence of the
// global proves nothing: resolving on it hands callers a module whose
// `mapkit.Map` / `mapkit.PolylineOverlay` constructors are still `undefined` and
// whose authorization token has never been configured. Apple invokes the global
// named by `data-callback` only once the SDK and its libraries are ready; that
// callback runs `mapkit.init()`, flips `mapkitInitialized`, and resolves the
// singleton. The script `load` listener and the polling loop are therefore pure
// FAILURE detectors — they never resolve, they only reject (script error, or the
// callback never firing within MAPKIT_LOAD_TIMEOUT_MS).
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
// Flipped inside the `data-callback` right after `mapkit.init()` succeeds. Never
// reset: once MapKit is initialized for this document it stays initialized.
let mapkitInitialized = false

/**
 * MapKit is usable only when we have initialized it AND its libraries are loaded.
 * Apple's own bootstrap guard checks `window.mapkit.loadedLibraries.length === 0`;
 * checking that a library-provided constructor such as `Map` exists is the same
 * signal expressed through our structural type (which does not declare
 * `loadedLibraries`), and it is what callers actually need.
 */
const isMapKitReady = (globalWindow: MapKitWindow) =>
  mapkitInitialized && typeof globalWindow.mapkit?.Map === 'function'

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
  if (isMapKitReady(globalWindow)) {
    return globalWindow.mapkit as T
  }

  // A bootstrap is already in flight: await the same callback rather than
  // short-circuiting on a half-initialised `window.mapkit`.
  if (!mapkitModulePromise) {
    const loadPromise = new Promise<unknown>((resolve, reject) => {
      let settled = false
      // Only one deadline per load, however many times the watchdog is armed.
      let watchdogArmed = false

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

      // Pure failure detector. It never resolves: only the `data-callback` can do
      // that. The poll exists so a script that loads (or hangs) without ever
      // invoking the callback rejects instead of leaving callers pending forever.
      const watchForInitTimeout = (timeoutMs = MAPKIT_LOAD_TIMEOUT_MS) => {
        if (watchdogArmed) {
          return
        }

        watchdogArmed = true
        const startedAt = Date.now()

        const poll = () => {
          // Stop polling once the promise is settled (the callback resolved, or
          // the script fired 'error' and rejected) so we don't keep scheduling
          // timers until the timeout elapses.
          if (settled) {
            return
          }

          if (Date.now() - startedAt >= timeoutMs) {
            rejectOnce(
              new Error(
                'MapKit was not initialized: the MapKit ready callback never fired'
              )
            )
            return
          }

          window.setTimeout(poll, 50)
        }

        poll()
      }

      // The sole resolve path. Registered before the script is injected: MapKit
      // reads `data-callback` off the script tag and invokes this global once the
      // SDK *and* its `data-libraries` are ready — which is the earliest moment
      // `mapkit.init()` may run and `mapkit.Map` exists.
      globalWindow[MAPKIT_CALLBACK_NAME] = () => {
        const mapkit = globalWindow.mapkit
        if (!mapkit) {
          return
        }

        initializeMapKit(mapkit)
        mapkitInitialized = true
        resolveOnce(mapkit)
      }

      const existingScript = document.querySelector<HTMLScriptElement>(
        MAPKIT_SCRIPT_SELECTOR
      )

      if (existingScript) {
        // A previous load already completed the bootstrap; nothing left to wait
        // for. Anything short of full readiness must wait for the callback.
        if (isMapKitReady(globalWindow)) {
          resolveOnce(globalWindow.mapkit)
          return
        }

        existingScript.addEventListener('error', onScriptError, { once: true })
        watchForInitTimeout()
        return
      }

      const script = document.createElement('script')
      script.src = MAPKIT_JS_SRC
      script.async = true
      script.setAttribute('crossorigin', 'anonymous')
      script.setAttribute('data-libraries', MAPKIT_LIBRARIES)
      script.setAttribute('data-callback', MAPKIT_CALLBACK_NAME)
      script.setAttribute('data-apple-mapkit-script', 'true')
      // 'load' only proves the resource arrived — the libraries may still be
      // loading and `mapkit.init()` has not run. It is a failure detector, not a
      // readiness signal, so it merely (re)arms the timeout watchdog.
      script.addEventListener('load', () => watchForInitTimeout(), {
        once: true
      })
      script.addEventListener('error', onScriptError, { once: true })

      document.head.appendChild(script)
      // Arm the watchdog immediately so a script that never loads at all (and
      // never errors) still rejects.
      watchForInitTimeout()
    })

    mapkitModulePromise = loadPromise.catch((error) => {
      mapkitModulePromise = null
      throw error
    })
  }

  return mapkitModulePromise as Promise<T>
}
