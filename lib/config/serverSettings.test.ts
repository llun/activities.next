import { SERVER_SETTING_FIELDS_BY_KEY } from './serverSettings'

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
