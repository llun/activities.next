import { getAppleMapsToken } from '@/lib/client'

// Apple MapKit JS loader for the Apple fitness map provider.
//
// Mirrors lib/utils/maplibre.ts and lib/utils/mapbox.ts: a singleton promise that
// injects Apple's CDN script once and resolves the `mapkit` global so callers can
// render maps without bundling the SDK.
//
// READINESS CONTRACT — a successful AUTHORIZATION is the only resolve path.
// `mapkit.core.js` assigns `window.mapkit` synchronously while it is still
// executing, long before the `data-libraries` (map, overlays, annotations) have
// loaded and before anyone has called `mapkit.init()`. So the presence of the
// global proves nothing: resolving on it hands callers a module whose
// `mapkit.Map` / `mapkit.PolylineOverlay` constructors are still `undefined` and
// whose authorization token has never been configured. Apple invokes the global
// named by `data-callback` only once the SDK and its libraries are ready — but
// that too is strictly weaker than "MapKit is usable": the callback fires whether
// or not the token Apple later receives is accepted. A rejected token leaves an
// authorized-never, permanently blank map.
//
// So the `data-callback` does NOT resolve. It subscribes to MapKit's own
// namespace events and then calls `mapkit.init()`:
//   - `configuration-change` with `status === 'Initialized'` is the first
//     successful authorization — that, and only that, resolves the singleton.
//   - `error` (status `Unauthorized`, `Too Many Requests`, `Initialization
//     Failed`, …) rejects it, so callers fall back to another provider.
// The script `load` listener, the polling loop, and a token fetch that never
// succeeds are pure FAILURE detectors — they never resolve, they only reject
// (script error, authorization failure, or neither event arriving within
// MAPKIT_LOAD_TIMEOUT_MS).
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
// A single transient 5xx from the token route must not blank an already-working
// map when MapKit refreshes its token (every ~30 minutes), so retry briefly.
const MAPKIT_TOKEN_ATTEMPTS = 3
const MAPKIT_TOKEN_RETRY_DELAYS_MS = [250, 750]

type MapKitTokenCallback = (token: string) => void

/**
 * MapKit namespace events. `status` carries values such as `'Initialized'` /
 * `'Refreshed'` (configuration-change) and `'Unauthorized'` / `'Too Many
 * Requests'` / `'Initialization Failed'` (error).
 */
interface MapKitEvent {
  status?: string
}

type MapKitEventListener = (event: MapKitEvent) => void

/**
 * Minimal structural view of the `mapkit` global — only the pieces this app uses.
 * The loader is generic (`loadMapKitModule<T>`) exactly like the GL loaders, so
 * callers can supply a richer type when they have one.
 */
export interface MapKitModule {
  init(options: {
    authorizationCallback: (done: MapKitTokenCallback) => void
  }): void
  addEventListener(type: string, listener: MapKitEventListener): void
  removeEventListener(type: string, listener: MapKitEventListener): void
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

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds)
  })

/**
 * `getAppleMapsToken` swallows every failure into `null`, so a transient 5xx is
 * indistinguishable from "provider not configured". Retry a couple of times with
 * a short backoff before treating the mint as permanently broken.
 */
const fetchAppleMapsTokenWithRetry = async (): Promise<string | null> => {
  for (let attempt = 0; attempt < MAPKIT_TOKEN_ATTEMPTS; attempt += 1) {
    const token = await getAppleMapsToken()
    if (token) {
      return token
    }

    const backoffMs = MAPKIT_TOKEN_RETRY_DELAYS_MS[attempt]
    if (backoffMs !== undefined) {
      await wait(backoffMs)
    }
  }

  return null
}

/**
 * MapKit re-invokes `authorizationCallback` whenever the token expires, so this
 * must stay side-effect free and re-runnable: always request a fresh short-lived
 * token, never cache or short-circuit.
 *
 * When no token can be minted at all, `done` is never called and MapKit can never
 * authorize. That is not a state a caller can recover from, so we surface it as a
 * load failure (`onAuthorizationFailure`) instead of silently leaving a blank map
 * behind. If MapKit accepts `done` but Apple rejects the token, MapKit itself
 * emits a namespace `error` event, which the loader turns into the same rejection.
 */
const initializeMapKit = (
  mapkit: MapKitModule,
  onAuthorizationFailure: (error: Error) => void
) => {
  mapkit.init({
    authorizationCallback: (done) => {
      void fetchAppleMapsTokenWithRetry().then((token) => {
        if (token) {
          done(token)
          return
        }

        onAuthorizationFailure(
          new Error(
            'MapKit was not initialized: no Apple Maps authorization token could be fetched'
          )
        )
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
      // Detach the MapKit namespace listeners once the outcome is decided.
      const settleHandlers: (() => void)[] = []

      const onSettled = (handler: () => void) => {
        if (settled) {
          handler()
          return
        }

        settleHandlers.push(handler)
      }

      const runSettleHandlers = () => {
        while (settleHandlers.length > 0) {
          settleHandlers.shift()?.()
        }
      }

      const resolveOnce = (value: unknown) => {
        if (settled) {
          return
        }

        settled = true
        runSettleHandlers()
        resolve(value)
      }

      const rejectOnce = (error: Error) => {
        if (settled) {
          return
        }

        settled = true
        runSettleHandlers()
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
                'MapKit was not initialized: neither the ready callback nor an authorization result arrived in time'
              )
            )
            return
          }

          window.setTimeout(poll, 50)
        }

        poll()
      }

      // Registered before the script is injected: MapKit reads `data-callback` off
      // the script tag and invokes this global once the SDK *and* its
      // `data-libraries` are ready — which is the earliest moment `mapkit.init()`
      // may run and `mapkit.Map` exists. It does not resolve: it subscribes to the
      // namespace events that report the authorization outcome, then inits.
      globalWindow[MAPKIT_CALLBACK_NAME] = () => {
        const mapkit = globalWindow.mapkit
        if (!mapkit) {
          return
        }

        const onMapKitError = (event: MapKitEvent) => {
          rejectOnce(
            new Error(
              `MapKit was not initialized: ${event?.status ?? 'MapKit reported an error'}`
            )
          )
        }

        // 'Initialized' is the first successful authorization; 'Refreshed' is a
        // later token rotation and tells us nothing new about readiness.
        const onConfigurationChange = (event: MapKitEvent) => {
          if (event?.status !== 'Initialized') {
            return
          }

          mapkitInitialized = true
          resolveOnce(mapkit)
        }

        mapkit.addEventListener('error', onMapKitError)
        mapkit.addEventListener('configuration-change', onConfigurationChange)
        onSettled(() => {
          mapkit.removeEventListener('error', onMapKitError)
          mapkit.removeEventListener(
            'configuration-change',
            onConfigurationChange
          )
        })

        initializeMapKit(mapkit, rejectOnce)
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
