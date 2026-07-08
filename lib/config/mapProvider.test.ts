import {
  MapProviderConfig,
  getMapProviderConfig,
  getPublicMapProvider
} from './mapProvider'

const APPLE_ENV = {
  ACTIVITIES_FITNESS_MAP_PROVIDER: 'apple',
  ACTIVITIES_FITNESS_APPLE_MAPS_TEAM_ID: 'TEAM123',
  ACTIVITIES_FITNESS_APPLE_MAPS_KEY_ID: 'KEY456',
  ACTIVITIES_FITNESS_APPLE_MAPS_PRIVATE_KEY: 'the-key'
}

describe('MapProvider config', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.ACTIVITIES_FITNESS_MAP_PROVIDER
    delete process.env.ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN
    delete process.env.ACTIVITIES_FITNESS_APPLE_MAPS_TEAM_ID
    delete process.env.ACTIVITIES_FITNESS_APPLE_MAPS_KEY_ID
    delete process.env.ACTIVITIES_FITNESS_APPLE_MAPS_PRIVATE_KEY
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('getMapProviderConfig', () => {
    it('resolves apple when the provider and all three credentials are set', () => {
      process.env.ACTIVITIES_FITNESS_MAP_PROVIDER = 'apple'
      process.env.ACTIVITIES_FITNESS_APPLE_MAPS_TEAM_ID = 'TEAM123'
      process.env.ACTIVITIES_FITNESS_APPLE_MAPS_KEY_ID = 'KEY456'
      process.env.ACTIVITIES_FITNESS_APPLE_MAPS_PRIVATE_KEY = 'apple-key'

      expect(getMapProviderConfig()).toEqual({
        type: 'apple',
        teamId: 'TEAM123',
        keyId: 'KEY456',
        privateKey: 'apple-key'
      })
    })

    it.each([
      ['team id', 'ACTIVITIES_FITNESS_APPLE_MAPS_TEAM_ID'],
      ['key id', 'ACTIVITIES_FITNESS_APPLE_MAPS_KEY_ID'],
      ['private key', 'ACTIVITIES_FITNESS_APPLE_MAPS_PRIVATE_KEY']
    ])(
      'falls back to osm when apple is missing its %s',
      (_label, missingKey) => {
        process.env.ACTIVITIES_FITNESS_MAP_PROVIDER = 'apple'
        process.env.ACTIVITIES_FITNESS_APPLE_MAPS_TEAM_ID = 'TEAM123'
        process.env.ACTIVITIES_FITNESS_APPLE_MAPS_KEY_ID = 'KEY456'
        process.env.ACTIVITIES_FITNESS_APPLE_MAPS_PRIVATE_KEY = 'apple-key'
        delete process.env[missingKey]

        expect(getMapProviderConfig()).toEqual({ type: 'osm' })
      }
    )

    it('treats whitespace-only apple credentials as unset', () => {
      process.env.ACTIVITIES_FITNESS_MAP_PROVIDER = 'apple'
      process.env.ACTIVITIES_FITNESS_APPLE_MAPS_TEAM_ID = 'TEAM123'
      process.env.ACTIVITIES_FITNESS_APPLE_MAPS_KEY_ID = '   '
      process.env.ACTIVITIES_FITNESS_APPLE_MAPS_PRIVATE_KEY = 'apple-key'

      expect(getMapProviderConfig()).toEqual({ type: 'osm' })
    })

    it('normalizes a single-line escaped PEM into a multi-line key', () => {
      process.env.ACTIVITIES_FITNESS_MAP_PROVIDER = 'apple'
      process.env.ACTIVITIES_FITNESS_APPLE_MAPS_TEAM_ID = 'TEAM123'
      process.env.ACTIVITIES_FITNESS_APPLE_MAPS_KEY_ID = 'KEY456'
      process.env.ACTIVITIES_FITNESS_APPLE_MAPS_PRIVATE_KEY =
        '-----BEGIN PRIVATE KEY-----\\nabc\\ndef\\n-----END PRIVATE KEY-----'

      const config = getMapProviderConfig()
      expect(config).toEqual({
        type: 'apple',
        teamId: 'TEAM123',
        keyId: 'KEY456',
        privateKey:
          '-----BEGIN PRIVATE KEY-----\nabc\ndef\n-----END PRIVATE KEY-----'
      })
    })

    it('resolves mapbox when the provider is mapbox and a token is set', () => {
      process.env.ACTIVITIES_FITNESS_MAP_PROVIDER = 'mapbox'
      process.env.ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN = 'sk.secret-token'

      expect(getMapProviderConfig()).toEqual({
        type: 'mapbox',
        accessToken: 'sk.secret-token'
      })
    })

    it('falls back to osm when the provider is mapbox but no token is set', () => {
      process.env.ACTIVITIES_FITNESS_MAP_PROVIDER = 'mapbox'

      expect(getMapProviderConfig()).toEqual({ type: 'osm' })
    })

    it('resolves osm when the provider is osm regardless of a stray token', () => {
      process.env.ACTIVITIES_FITNESS_MAP_PROVIDER = 'osm'
      process.env.ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN = 'pk.public-token'

      expect(getMapProviderConfig()).toEqual({ type: 'osm' })
    })

    it.each([
      ['unset provider', undefined],
      ['unknown provider', 'martian-maps']
    ])(
      'infers mapbox from the legacy token with %s',
      (_label, providerValue) => {
        if (providerValue !== undefined) {
          process.env.ACTIVITIES_FITNESS_MAP_PROVIDER = providerValue
        }
        process.env.ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN = 'pk.public-token'

        expect(getMapProviderConfig()).toEqual({
          type: 'mapbox',
          accessToken: 'pk.public-token'
        })
      }
    )

    it.each([
      ['unset provider', undefined],
      ['unknown provider', 'martian-maps']
    ])(
      'infers osm from the missing legacy token with %s',
      (_label, providerValue) => {
        if (providerValue !== undefined) {
          process.env.ACTIVITIES_FITNESS_MAP_PROVIDER = providerValue
        }

        expect(getMapProviderConfig()).toEqual({ type: 'osm' })
      }
    )

    it('trims surrounding whitespace on the mapbox token', () => {
      process.env.ACTIVITIES_FITNESS_MAP_PROVIDER = 'mapbox'
      process.env.ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN = '  pk.token  '

      expect(getMapProviderConfig()).toEqual({
        type: 'mapbox',
        accessToken: 'pk.token'
      })
    })
  })

  describe('getPublicMapProvider', () => {
    it('derives an apple public descriptor without credentials', () => {
      Object.assign(process.env, APPLE_ENV)

      expect(getPublicMapProvider()).toEqual({ type: 'apple' })
    })

    it('exposes a public pk. mapbox token to the browser', () => {
      process.env.ACTIVITIES_FITNESS_MAP_PROVIDER = 'mapbox'
      process.env.ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN = 'pk.public-token'

      expect(getPublicMapProvider()).toEqual({
        type: 'mapbox',
        accessToken: 'pk.public-token'
      })
    })

    it('downgrades a secret sk. mapbox token to keyless osm', () => {
      process.env.ACTIVITIES_FITNESS_MAP_PROVIDER = 'mapbox'
      process.env.ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN = 'sk.secret-token'

      expect(getPublicMapProvider()).toEqual({ type: 'osm' })
    })

    it('returns osm for the osm provider', () => {
      process.env.ACTIVITIES_FITNESS_MAP_PROVIDER = 'osm'

      expect(getPublicMapProvider()).toEqual({ type: 'osm' })
    })
  })
})

// Type-level assertion that the union is exported and usable by consumers.
const _typeCheck: MapProviderConfig = { type: 'osm' }
void _typeCheck
