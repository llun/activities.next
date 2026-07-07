import { loadMapboxModule } from '@/lib/utils/mapbox'
import {
  OPENFREEMAP_HEATMAP_STYLE_URL,
  OPENFREEMAP_STYLE_URL,
  loadMaplibreModule
} from '@/lib/utils/maplibre'

/**
 * The set of fitness map providers the app can render with. Owned here so the
 * map-provider config module can import the type without pulling in the browser
 * GL loaders. Apple Maps is a distinct, non-GL provider; Mapbox and OpenFreeMap
 * (OSM) both render through the shared Mapbox GL / MapLibre GL surface.
 */
export type PublicMapProvider =
  | { type: 'apple' }
  | { type: 'mapbox'; accessToken: string } // pk.-prefixed public token only
  | { type: 'osm' }

/**
 * Which basemap flavour a GL map should render. `outdoors` is the colourful
 * terrain style used by the region picker; `light` is the low-saturation basemap
 * used by the route heatmap result map so the coloured overlay stays legible.
 */
export type GlStyleVariant = 'outdoors' | 'light'

export interface GlProviderOptions {
  loadModule: () => Promise<unknown>
  mapOptions: Record<string, unknown>
  label: 'Mapbox' | 'OpenFreeMap'
}

/**
 * Resolve the GL engine + Map constructor options for a non-Apple provider. This
 * centralises the provider descriptors previously duplicated in
 * RouteHeatmapMap (Mapbox-vs-MapLibre memo) and HeatmapRegionPicker (the
 * RectComposer memo). The caller spreads the remaining Map constructor options
 * (container/center/zoom/…) around `mapOptions` itself, so only style,
 * projection, and accessToken are set here.
 */
export const buildGlProviderOptions = (
  provider: Exclude<PublicMapProvider, { type: 'apple' }>,
  variant: GlStyleVariant
): GlProviderOptions => {
  if (provider.type === 'mapbox') {
    const mapOptions: Record<string, unknown> = {
      style:
        variant === 'light'
          ? 'mapbox://styles/mapbox/light-v11'
          : 'mapbox://styles/mapbox/outdoors-v12',
      // Mapbox GL consumes the public token as a Map constructor option; a
      // mapbox:// style is loaded natively (no transformRequest / REST URL).
      accessToken: provider.accessToken
    }
    // An explicit mercator projection so a wide cache opens as a flat, pannable
    // map instead of Mapbox GL v3's default zoomed-out globe. Only the light
    // (heatmap result) variant framed this way historically.
    if (variant === 'light') {
      mapOptions.projection = 'mercator'
    }
    return {
      loadModule: loadMapboxModule,
      mapOptions,
      label: 'Mapbox'
    }
  }

  return {
    loadModule: loadMaplibreModule,
    // MapLibre renders a flat mercator map by default; the light "positron"
    // style keeps the route overlay legible, while "bright" is used elsewhere.
    mapOptions: {
      style:
        variant === 'light'
          ? OPENFREEMAP_HEATMAP_STYLE_URL
          : OPENFREEMAP_STYLE_URL
    },
    label: 'OpenFreeMap'
  }
}
