import { describe, expect, it } from 'vitest'

import {
  GlStyleVariant,
  PublicMapProvider,
  buildGlProviderOptions
} from '@/lib/utils/mapProvider'
import { loadMapboxModule } from '@/lib/utils/mapbox'
import {
  OPENFREEMAP_HEATMAP_STYLE_URL,
  OPENFREEMAP_STYLE_URL,
  loadMaplibreModule
} from '@/lib/utils/maplibre'

const MAPBOX_TOKEN = 'pk.test-token'
// What MapLibre's own default attribution control credits MapLibre with; the
// OpenFreeMap map builds its control by hand, which drops it unless it is passed.
const MAPLIBRE_CREDIT =
  '<a href="https://maplibre.org/" target="_blank">MapLibre</a>'

interface Case {
  description: string
  provider: Exclude<PublicMapProvider, { type: 'apple' }>
  variant: GlStyleVariant
  expectedLoadModule: () => Promise<unknown>
  expectedStyle: string
  expectedLabel: 'Mapbox' | 'OpenFreeMap'
  expectedAccessToken?: string
  expectedProjection?: string
  expectedCustomAttribution?: string
}

describe('buildGlProviderOptions', () => {
  const cases: Case[] = [
    {
      description: 'mapbox + outdoors',
      provider: { type: 'mapbox', accessToken: MAPBOX_TOKEN },
      variant: 'outdoors',
      expectedLoadModule: loadMapboxModule,
      expectedStyle: 'mapbox://styles/mapbox/outdoors-v12',
      expectedLabel: 'Mapbox',
      expectedAccessToken: MAPBOX_TOKEN
    },
    {
      description: 'mapbox + light',
      provider: { type: 'mapbox', accessToken: MAPBOX_TOKEN },
      variant: 'light',
      expectedLoadModule: loadMapboxModule,
      expectedStyle: 'mapbox://styles/mapbox/light-v11',
      expectedLabel: 'Mapbox',
      expectedAccessToken: MAPBOX_TOKEN,
      expectedProjection: 'mercator'
    },
    {
      description: 'osm + outdoors',
      provider: { type: 'osm' },
      variant: 'outdoors',
      expectedLoadModule: loadMaplibreModule,
      expectedStyle: OPENFREEMAP_STYLE_URL,
      expectedLabel: 'OpenFreeMap',
      expectedCustomAttribution: MAPLIBRE_CREDIT
    },
    {
      description: 'osm + light',
      provider: { type: 'osm' },
      variant: 'light',
      expectedLoadModule: loadMaplibreModule,
      expectedStyle: OPENFREEMAP_HEATMAP_STYLE_URL,
      expectedLabel: 'OpenFreeMap',
      expectedCustomAttribution: MAPLIBRE_CREDIT
    }
  ]

  it.each(cases)(
    'resolves the GL engine and options for $description',
    ({
      provider,
      variant,
      expectedLoadModule,
      expectedStyle,
      expectedLabel,
      expectedAccessToken,
      expectedProjection,
      expectedCustomAttribution
    }) => {
      const options = buildGlProviderOptions(provider, variant)

      expect(options.loadModule).toBe(expectedLoadModule)
      expect(options.mapOptions.style).toBe(expectedStyle)
      expect(options.label).toBe(expectedLabel)

      if (expectedAccessToken === undefined) {
        expect(options.mapOptions).not.toHaveProperty('accessToken')
      } else {
        expect(options.mapOptions.accessToken).toBe(expectedAccessToken)
      }

      // MapLibre credits itself; Mapbox has no such credit to add.
      expect(options.customAttribution).toBe(expectedCustomAttribution)

      if (expectedProjection === undefined) {
        expect(options.mapOptions).not.toHaveProperty('projection')
      } else {
        expect(options.mapOptions.projection).toBe(expectedProjection)
      }
    }
  )
})
