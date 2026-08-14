import { NAV_FEATURE_KEYS } from '@/lib/services/navigation/navPreferences'

import {
  DEFAULT_SERVER_SETTINGS,
  SERVER_SETTING_FIELDS_BY_KEY
} from './serverSettings'

const readEnvFor = (key: string) => SERVER_SETTING_FIELDS_BY_KEY[key].readEnv()

const ENV_KEYS = [
  'ACTIVITIES_REQUEST_TIMEOUT',
  'ACTIVITIES_REGISTRATION_OPEN',
  'ACTIVITIES_FEDERATION_MODE',
  'ACTIVITIES_ALLOW_EMAILS',
  'ACTIVITIES_LANGUAGES'
]

describe('server settings registry env parsers', () => {
  let savedEnv: Record<string, string | undefined>

  beforeEach(() => {
    savedEnv = {}
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key]
      else process.env[key] = savedEnv[key]
    }
  })

  it('parses numeric env vars with parseInt, matching getConfig', () => {
    // parseInt (not Number) is what getConfig's getOptionalInteger uses.
    process.env.ACTIVITIES_REQUEST_TIMEOUT = '5000ms'
    expect(readEnvFor('network.requestTimeoutMs')).toBe(5000)
    process.env.ACTIVITIES_REQUEST_TIMEOUT = '500.9'
    expect(readEnvFor('network.requestTimeoutMs')).toBe(500)
    process.env.ACTIVITIES_REQUEST_TIMEOUT = ''
    expect(readEnvFor('network.requestTimeoutMs')).toBeUndefined()
    process.env.ACTIVITIES_REQUEST_TIMEOUT = 'abc'
    expect(readEnvFor('network.requestTimeoutMs')).toBeUndefined()
  })

  it('returns undefined for an unset variable (unlocked)', () => {
    expect(readEnvFor('network.requestTimeoutMs')).toBeUndefined()
    expect(readEnvFor('registrations.open')).toBeUndefined()
    expect(readEnvFor('federation.mode')).toBeUndefined()
  })

  it('reads registration-open as false only for the literal "false"', () => {
    process.env.ACTIVITIES_REGISTRATION_OPEN = 'false'
    expect(readEnvFor('registrations.open')).toBe(false)
    process.env.ACTIVITIES_REGISTRATION_OPEN = 'true'
    expect(readEnvFor('registrations.open')).toBe(true)
    process.env.ACTIVITIES_REGISTRATION_OPEN = 'anything'
    expect(readEnvFor('registrations.open')).toBe(true)
  })

  it('reads federation mode strictly and ignores an invalid value', () => {
    process.env.ACTIVITIES_FEDERATION_MODE = 'allowlist'
    expect(readEnvFor('federation.mode')).toBe('allowlist')
    process.env.ACTIVITIES_FEDERATION_MODE = 'open'
    expect(readEnvFor('federation.mode')).toBe('open')
    process.env.ACTIVITIES_FEDERATION_MODE = ''
    expect(readEnvFor('federation.mode')).toBe('open')
    // A typo must not silently coerce to the more permissive 'open'.
    process.env.ACTIVITIES_FEDERATION_MODE = 'allowlst'
    expect(readEnvFor('federation.mode')).toBeUndefined()
  })

  it('normalizes allowed emails and parses languages from JSON', () => {
    process.env.ACTIVITIES_ALLOW_EMAILS = '["A@Example.com"]'
    expect(readEnvFor('registrations.allowEmails')).toEqual(['a@example.com'])
    process.env.ACTIVITIES_LANGUAGES = '["en","th"]'
    expect(readEnvFor('instance.languages')).toEqual(['en', 'th'])
  })
})

describe('optional feature settings', () => {
  // The navigation registry decides which features exist. One added there
  // without a field here still type-checks — the surfaces take a partial flag
  // map and read a missing key as on — so the switch would never appear in the
  // admin form and the feature could never be turned off.
  it.each(NAV_FEATURE_KEYS.map((feature) => [feature]))(
    'gives %s an instance switch that ships turned on',
    (feature) => {
      const field = SERVER_SETTING_FIELDS_BY_KEY[`features.${feature}`]

      expect(field).toBeDefined()
      expect(field.group).toBe('instance')
      expect(field.schema.safeParse(false).success).toBe(true)
      expect(field.schema.safeParse('off').success).toBe(false)
      expect(DEFAULT_SERVER_SETTINGS.features[feature]).toBe(true)
    }
  )
})
