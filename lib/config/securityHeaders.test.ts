import fs from 'fs'
import os from 'os'
import path from 'path'

import { getSecurityHeaderConfig } from './securityHeaders'

const SECURITY_HEADER_ENV_KEYS = [
  'ACTIVITIES_ALLOW_MEDIA_DOMAINS',
  'ACTIVITIES_MEDIA_STORAGE_TYPE',
  'ACTIVITIES_MEDIA_STORAGE_BUCKET',
  'ACTIVITIES_MEDIA_STORAGE_REGION',
  'ACTIVITIES_MEDIA_STORAGE_HOSTNAME',
  'ACTIVITIES_FITNESS_STORAGE_TYPE',
  'ACTIVITIES_FITNESS_STORAGE_BUCKET',
  'ACTIVITIES_FITNESS_STORAGE_REGION',
  'ACTIVITIES_FITNESS_STORAGE_HOSTNAME',
  'ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN'
]

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
    process.env.ACTIVITIES_MEDIA_STORAGE_HOSTNAME = 'env-media.example.com'
    process.env.ACTIVITIES_FITNESS_STORAGE_TYPE = 'object'
    process.env.ACTIVITIES_FITNESS_STORAGE_BUCKET = 'env-fitness-bucket'
    process.env.ACTIVITIES_FITNESS_STORAGE_REGION = 'us-east-1'
    process.env.ACTIVITIES_FITNESS_STORAGE_HOSTNAME = 'env-fitness.example.com'
    process.env.ACTIVITIES_FITNESS_MAPBOX_ACCESS_TOKEN = 'pk.env-mapbox'

    expect(getSecurityHeaderConfig()).toEqual({
      allowMediaDomains: ['env-images.example.com'],
      mediaStorage: {
        hostname: 'env-media.example.com'
      },
      fitnessStorage: {
        type: 'object',
        bucket: 'env-fitness-bucket',
        region: 'us-east-1',
        hostname: 'env-fitness.example.com',
        mapboxAccessToken: 'pk.env-mapbox'
      }
    })
  })

  it('uses empty settings when scoped environment settings are absent', () => {
    fs.writeFileSync(
      path.join(tempDirectory, 'config.json'),
      JSON.stringify({
        allowMediaDomains: ['file-images.example.com'],
        mediaStorage: {
          type: 's3',
          bucket: 'file-media-bucket',
          region: 'eu-central-1'
        },
        fitnessStorage: {
          type: 'object',
          bucket: 'file-fitness-bucket',
          region: 'us-east-1',
          hostname: 'file-fitness.example.com',
          mapboxAccessToken: 'pk.file-mapbox'
        }
      })
    )

    expect(getSecurityHeaderConfig()).toEqual({
      allowMediaDomains: [],
      mediaStorage: {},
      fitnessStorage: {}
    })
  })

  it('keeps an explicit empty runtime environment media allowlist when config file has values', () => {
    fs.writeFileSync(
      path.join(tempDirectory, 'config.json'),
      JSON.stringify({
        allowMediaDomains: ['file-images.example.com']
      })
    )
    process.env.ACTIVITIES_ALLOW_MEDIA_DOMAINS = '[]'

    expect(getSecurityHeaderConfig()).toEqual({
      allowMediaDomains: [],
      mediaStorage: {},
      fitnessStorage: {}
    })
  })

  it('uses runtime environment settings when the config file has no security header settings', () => {
    fs.writeFileSync(
      path.join(tempDirectory, 'config.json'),
      JSON.stringify({ host: 'file-host.example.com' })
    )
    process.env.ACTIVITIES_MEDIA_STORAGE_HOSTNAME = 'env-media.example.com'

    expect(getSecurityHeaderConfig()).toEqual({
      allowMediaDomains: [],
      mediaStorage: {
        hostname: 'env-media.example.com'
      },
      fitnessStorage: {}
    })
  })
})
