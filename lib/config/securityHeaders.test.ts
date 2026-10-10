import fs from 'fs'
import os from 'os'
import path from 'path'

import { getSecurityHeaderConfig } from './securityHeaders'

const SECURITY_HEADER_ENV_KEYS = [
  'ACTIVITIES_ALLOW_MEDIA_DOMAINS',
  'ACTIVITIES_ALLOW_REMOTE_MEDIA_DOMAINS',
  'ACTIVITIES_MEDIA_STORAGE_TYPE',
  'ACTIVITIES_MEDIA_STORAGE_BUCKET',
  'ACTIVITIES_MEDIA_STORAGE_REGION',
  'ACTIVITIES_MEDIA_STORAGE_HOSTNAME',
  'ACTIVITIES_MEDIA_STORAGE_ENDPOINT',
  'ACTIVITIES_FITNESS_STORAGE_TYPE',
  'ACTIVITIES_FITNESS_STORAGE_BUCKET',
  'ACTIVITIES_FITNESS_STORAGE_REGION',
  'ACTIVITIES_FITNESS_STORAGE_HOSTNAME',
  'ACTIVITIES_FITNESS_STORAGE_ENDPOINT',
  'ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN',
  'ACTIVITIES_PHOTO_MASK_MODEL_BASE_URL'
]

// The photo editor's subject model is on by default, from Hugging Face.
const DEFAULT_MODEL_ORIGINS = ['https://huggingface.co', 'https://*.hf.co']

describe('getSecurityHeaderConfig', () => {
  const originalCwd = process.cwd()
  const originalEnv = Object.fromEntries(
    SECURITY_HEADER_ENV_KEYS.map((key) => [key, process.env[key]])
  )
  let tempDirectory: string

  beforeEach(() => {
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'activities-next-'))
    process.chdir(tempDirectory)

    for (const key of SECURITY_HEADER_ENV_KEYS) {
      delete process.env[key]
    }
  })

  afterEach(() => {
    process.chdir(originalCwd)
    fs.rmSync(tempDirectory, { force: true, recursive: true })

    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  })

  it('uses runtime environment settings and ignores runtime config file settings', () => {
    fs.writeFileSync(
      path.join(tempDirectory, 'config.json'),
      JSON.stringify({
        allowMediaDomains: ['file-images.example.com'],
        mediaStorage: {
          type: 's3',
          bucket: 'file-media-bucket',
          region: 'eu-central-1',
          hostname: 'file-media.example.com'
        }
      })
    )
    process.env.ACTIVITIES_ALLOW_MEDIA_DOMAINS = JSON.stringify([
      'env-images.example.com'
    ])
    process.env.ACTIVITIES_ALLOW_REMOTE_MEDIA_DOMAINS = JSON.stringify([
      'remote-images.example.com'
    ])
    process.env.ACTIVITIES_MEDIA_STORAGE_HOSTNAME = 'env-media.example.com'
    process.env.ACTIVITIES_MEDIA_STORAGE_ENDPOINT =
      'https://env-media-storage.example.com'
    process.env.ACTIVITIES_FITNESS_STORAGE_TYPE = 'object'
    process.env.ACTIVITIES_FITNESS_STORAGE_BUCKET = 'env-fitness-bucket'
    process.env.ACTIVITIES_FITNESS_STORAGE_REGION = 'us-east-1'
    process.env.ACTIVITIES_FITNESS_STORAGE_HOSTNAME = 'env-fitness.example.com'
    process.env.ACTIVITIES_FITNESS_STORAGE_ENDPOINT =
      'https://env-fitness-storage.example.com'
    process.env.ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN = 'pk.env-mapbox'

    expect(getSecurityHeaderConfig()).toEqual({
      allowMediaDomains: ['env-images.example.com'],
      allowRemoteMediaDomains: ['remote-images.example.com'],
      mediaStorage: {
        hostname: 'env-media.example.com',
        endpoint: 'https://env-media-storage.example.com'
      },
      fitnessStorage: {
        type: 'object',
        bucket: 'env-fitness-bucket',
        region: 'us-east-1',
        hostname: 'env-fitness.example.com',
        endpoint: 'https://env-fitness-storage.example.com',
        mapboxAccessToken: 'pk.env-mapbox'
      },
      photoEditorModelOrigins: DEFAULT_MODEL_ORIGINS
    })
  })

  it('uses empty settings when scoped environment settings are absent', () => {
    expect(getSecurityHeaderConfig()).toEqual({
      allowMediaDomains: [],
      allowRemoteMediaDomains: null,
      mediaStorage: {},
      fitnessStorage: {},
      photoEditorModelOrigins: DEFAULT_MODEL_ORIGINS
    })
  })

  it('treats blank runtime environment remote media allowlist as absent', () => {
    for (const value of ['', '   ']) {
      process.env.ACTIVITIES_ALLOW_REMOTE_MEDIA_DOMAINS = value

      expect(getSecurityHeaderConfig()).toEqual({
        allowMediaDomains: [],
        allowRemoteMediaDomains: null,
        mediaStorage: {},
        fitnessStorage: {},
        photoEditorModelOrigins: DEFAULT_MODEL_ORIGINS
      })
    }
  })

  it('keeps an explicit empty runtime environment media allowlist', () => {
    process.env.ACTIVITIES_ALLOW_MEDIA_DOMAINS = '[]'

    expect(getSecurityHeaderConfig()).toEqual({
      allowMediaDomains: [],
      allowRemoteMediaDomains: null,
      mediaStorage: {},
      fitnessStorage: {},
      photoEditorModelOrigins: DEFAULT_MODEL_ORIGINS
    })
  })

  it('keeps an explicit empty runtime environment remote media allowlist', () => {
    process.env.ACTIVITIES_ALLOW_REMOTE_MEDIA_DOMAINS = '[]'

    expect(getSecurityHeaderConfig()).toEqual({
      allowMediaDomains: [],
      allowRemoteMediaDomains: [],
      mediaStorage: {},
      fitnessStorage: {},
      photoEditorModelOrigins: DEFAULT_MODEL_ORIGINS
    })
  })

  it('throws for malformed runtime environment remote media allowlist', () => {
    process.env.ACTIVITIES_ALLOW_REMOTE_MEDIA_DOMAINS = 'not-json'

    expect(() => getSecurityHeaderConfig()).toThrow()
  })

  it('uses runtime environment media storage settings', () => {
    process.env.ACTIVITIES_MEDIA_STORAGE_HOSTNAME = 'env-media.example.com'

    expect(getSecurityHeaderConfig()).toEqual({
      allowMediaDomains: [],
      allowRemoteMediaDomains: null,
      mediaStorage: {
        hostname: 'env-media.example.com'
      },
      fitnessStorage: {},
      photoEditorModelOrigins: DEFAULT_MODEL_ORIGINS
    })
  })

  it.each([
    ['off', 'off', null],
    ['an invalid value', 'http://models.example.com/', null],
    [
      'a self-hosted base',
      'https://models.example.com/slimsam/',
      ['https://models.example.com']
    ]
  ])('reads the photo editor model origins for %s', (_, value, origins) => {
    process.env.ACTIVITIES_PHOTO_MASK_MODEL_BASE_URL = value

    expect(getSecurityHeaderConfig().photoEditorModelOrigins).toEqual(origins)
  })
})
