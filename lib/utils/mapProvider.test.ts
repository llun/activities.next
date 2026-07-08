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

interface Case {
  description: string
  provider: Exclude<PublicMapProvider, { type: 'apple' }>
  variant: GlStyleVariant
  expectedLoadModule: () => Promise<unknown>
  expectedStyle: string
  expectedLabel: 'Mapbox' | 'OpenFreeMap'
  expectedAccessToken?: string
  expectedProjection?: string
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
      expectedLabel: 'OpenFreeMap'
    },
    {
      description: 'osm + light',
      provider: { type: 'osm' },
      variant: 'light',
      expectedLoadModule: loadMaplibreModule,
      expectedStyle: OPENFREEMAP_HEATMAP_STYLE_URL,
      expectedLabel: 'OpenFreeMap'
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
      expectedProjection
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

      if (expectedProjection === undefined) {
        expect(options.mapOptions).not.toHaveProperty('projection')
      } else {
        expect(options.mapOptions.projection).toBe(expectedProjection)
      }
    }
  )
})
