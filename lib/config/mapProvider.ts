import type { PublicMapProvider } from '@/lib/utils/mapProvider'

// Re-exported so consumers can import the public descriptor type alongside the
// config getters without reaching into the browser GL loader module. The import
// above is type-only and erased at compile time, keeping this module safe for
// the Edge/CSP bundle.
export type { PublicMapProvider }

/**
 * Fully resolved, server-side map provider configuration. Unlike
 * {@link PublicMapProvider} this carries the secret credentials (Apple Maps
 * signing key, any Mapbox token including secret `sk.` tokens) and must never be
 * sent to the browser.
 */
export type MapProviderConfig =
  | { type: 'apple'; teamId: string; keyId: string; privateKey: string }
  | { type: 'mapbox'; accessToken: string }
  | { type: 'osm' }

const readTrimmed = (key: string): string => (process.env[key] ?? '').trim()

/**
 * Resolve the active fitness map provider from the environment.
 *
 * `ACTIVITIES_FITNESS_MAP_PROVIDER` selects the backend explicitly (`apple`,
 * `mapbox`, or `osm`). When the selected provider is missing its required
 * credentials the resolver falls back to keyless OpenStreetMap so the app keeps
 * rendering maps. When the variable is unset or holds an unknown value the
 * legacy behaviour is inferred: Mapbox when a token is present, otherwise OSM.
 */
export const getMapProviderConfig = (): MapProviderConfig => {
  const provider = readTrimmed('ACTIVITIES_FITNESS_MAP_PROVIDER')
  const mapboxAccessToken = readTrimmed(
    'ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN'
  )

  if (provider === 'apple') {
    const teamId = readTrimmed('ACTIVITIES_FITNESS_APPLE_MAPS_TEAM_ID')
    const keyId = readTrimmed('ACTIVITIES_FITNESS_APPLE_MAPS_KEY_ID')
    const privateKey = readTrimmed('ACTIVITIES_FITNESS_APPLE_MAPS_PRIVATE_KEY')
    if (teamId && keyId && privateKey) {
      return {
        type: 'apple',
        teamId,
        keyId,
        // Accept a single-line, `\n`-escaped PEM from the environment and expand
        // it back into a real multi-line key.
        privateKey: privateKey.replace(/\\n/g, '\n')
      }
    }
    return { type: 'osm' }
  }

  if (provider === 'mapbox') {
    if (mapboxAccessToken)
      return { type: 'mapbox', accessToken: mapboxAccessToken }
    return { type: 'osm' }
  }

  if (provider === 'osm') return { type: 'osm' }

  // Unset or unknown value: infer from the legacy Mapbox token for back-compat.
  if (mapboxAccessToken)
    return { type: 'mapbox', accessToken: mapboxAccessToken }
  return { type: 'osm' }
}

/**
 * Derive the client-safe map descriptor from {@link getMapProviderConfig}.
 *
 * Only public Mapbox tokens (`pk.` prefix) are exposed to the browser; secret
 * `sk.` tokens are server-only, so a browser configured that way falls back to
 * keyless OSM. Apple resolves to the credential-free `{ type: 'apple' }` marker.
 */
export const getPublicMapProvider = (): PublicMapProvider => {
  const config = getMapProviderConfig()
  switch (config.type) {
    case 'apple':
      return { type: 'apple' }
    case 'mapbox':
      return config.accessToken.startsWith('pk.')
        ? { type: 'mapbox', accessToken: config.accessToken }
        : { type: 'osm' }
    default:
      return { type: 'osm' }
  }
}
