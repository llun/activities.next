import { getEmailConfig } from './email'

describe('getEmailConfig', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('returns null when no email env vars are set', () => {
    delete process.env.ACTIVITIES_EMAIL
    delete process.env.ACTIVITIES_EMAIL_TYPE

    const config = getEmailConfig()

    expect(config).toBeNull()
  })

  it('parses ACTIVITIES_EMAIL JSON env var (backward compat)', () => {
    process.env.ACTIVITIES_EMAIL = JSON.stringify({
      type: 'resend',
      serviceFromAddress: 'noreply@example.com',
      token: 'old-token'
    })

    const config = getEmailConfig()

    expect(config).not.toBeNull()
    expect(config?.email.type).toBe('resend')
    expect(config?.email.serviceFromAddress).toBe('noreply@example.com')
  })

  it('falls through to individual env vars when ACTIVITIES_EMAIL contains malformed JSON', () => {
    process.env.ACTIVITIES_EMAIL = 'not-valid-json'
    process.env.ACTIVITIES_EMAIL_TYPE = 'resend'
    process.env.ACTIVITIES_EMAIL_FROM = 'fallback@example.com'
    process.env.ACTIVITIES_EMAIL_RESEND_TOKEN = 'fallback-token'

    const config = getEmailConfig()

    expect(config).not.toBeNull()
    expect(config?.email.type).toBe('resend')
    expect(config?.email.serviceFromAddress).toBe('fallback@example.com')
  })

  it('prefers ACTIVITIES_EMAIL JSON over individual env vars', () => {
    process.env.ACTIVITIES_EMAIL = JSON.stringify({
      type: 'resend',
      serviceFromAddress: 'json@example.com',
      token: 'json-token'
    })
    process.env.ACTIVITIES_EMAIL_TYPE = 'smtp'
    process.env.ACTIVITIES_EMAIL_FROM = 'individual@example.com'

    const config = getEmailConfig()

    expect(config?.email.serviceFromAddress).toBe('json@example.com')
    expect(config?.email.type).toBe('resend')
  })

  it('builds SMTP config from individual env vars', () => {
    process.env.ACTIVITIES_EMAIL_TYPE = 'smtp'
    process.env.ACTIVITIES_EMAIL_FROM = 'noreply@example.com'
    process.env.ACTIVITIES_EMAIL_SMTP_HOST = 'mail.example.com'
    process.env.ACTIVITIES_EMAIL_SMTP_PORT = '587'
    process.env.ACTIVITIES_EMAIL_SMTP_USER = 'user@example.com'
    process.env.ACTIVITIES_EMAIL_SMTP_PASSWORD = 'secret'
    process.env.ACTIVITIES_EMAIL_SMTP_SECURE = 'true'

    const config = getEmailConfig()

    expect(config).not.toBeNull()
    expect(config?.email.type).toBe('smtp')
    expect(config?.email.serviceFromAddress).toBe('noreply@example.com')

    const email = config?.email as { host: string; port: number; auth: { user: string; pass: string }; secure: boolean }
    expect(email.host).toBe('mail.example.com')
    expect(email.port).toBe(587)
    expect(email.auth?.user).toBe('user@example.com')
    expect(email.auth?.pass).toBe('secret')
    expect(email.secure).toBe(true)
  })

  it('omits SMTP auth when only user is set (requires both)', () => {
    process.env.ACTIVITIES_EMAIL_TYPE = 'smtp'
    process.env.ACTIVITIES_EMAIL_FROM = 'noreply@example.com'
    process.env.ACTIVITIES_EMAIL_SMTP_HOST = 'mail.example.com'
    process.env.ACTIVITIES_EMAIL_SMTP_USER = 'user@example.com'
    // no ACTIVITIES_EMAIL_SMTP_PASSWORD

    const config = getEmailConfig()
    const email = config?.email as { auth?: unknown }

    expect(email.auth).toBeUndefined()
  })

  it('omits SMTP auth when only password is set (requires both)', () => {
    process.env.ACTIVITIES_EMAIL_TYPE = 'smtp'
    process.env.ACTIVITIES_EMAIL_FROM = 'noreply@example.com'
    process.env.ACTIVITIES_EMAIL_SMTP_HOST = 'mail.example.com'
    process.env.ACTIVITIES_EMAIL_SMTP_PASSWORD = 'secret'
    // no ACTIVITIES_EMAIL_SMTP_USER

    const config = getEmailConfig()
    const email = config?.email as { auth?: unknown }

    expect(email.auth).toBeUndefined()
  })

  it('returns undefined port when SMTP port is not a valid number', () => {
    process.env.ACTIVITIES_EMAIL_TYPE = 'smtp'
    process.env.ACTIVITIES_EMAIL_FROM = 'noreply@example.com'
    process.env.ACTIVITIES_EMAIL_SMTP_HOST = 'mail.example.com'
    process.env.ACTIVITIES_EMAIL_SMTP_PORT = 'not-a-number'

    const config = getEmailConfig()
    const email = config?.email as { port?: number }

    expect(email.port).toBeUndefined()
  })

  it('builds Resend config from individual env vars', () => {
    process.env.ACTIVITIES_EMAIL_TYPE = 'resend'
    process.env.ACTIVITIES_EMAIL_FROM = 'noreply@example.com'
    process.env.ACTIVITIES_EMAIL_RESEND_TOKEN = 're_abc123'

    const config = getEmailConfig()

    expect(config).not.toBeNull()
    expect(config?.email.type).toBe('resend')
    expect(config?.email.serviceFromAddress).toBe('noreply@example.com')

    const email = config?.email as { token: string }
    expect(email.token).toBe('re_abc123')
  })

  it('returns undefined token when ACTIVITIES_EMAIL_RESEND_TOKEN is absent', () => {
    process.env.ACTIVITIES_EMAIL_TYPE = 'resend'
    process.env.ACTIVITIES_EMAIL_FROM = 'noreply@example.com'
    // ACTIVITIES_EMAIL_RESEND_TOKEN intentionally absent

    const config = getEmailConfig()
    const email = config?.email as { token?: string }

    expect(email.token).toBeUndefined()
  })

  it('builds Lambda config from individual env vars', () => {
    process.env.ACTIVITIES_EMAIL_TYPE = 'lambda'
    process.env.ACTIVITIES_EMAIL_FROM = 'noreply@example.com'
    process.env.ACTIVITIES_EMAIL_LAMBDA_REGION = 'us-east-1'
    process.env.ACTIVITIES_EMAIL_LAMBDA_FUNCTION_NAME = 'send-email'
    process.env.ACTIVITIES_EMAIL_LAMBDA_FUNCTION_QUALIFIER = 'LIVE'

    const config = getEmailConfig()

    expect(config).not.toBeNull()
    expect(config?.email.type).toBe('lambda')
    expect(config?.email.serviceFromAddress).toBe('noreply@example.com')

    const email = config?.email as { region: string; functionName: string; functionQualifier: string }
    expect(email.region).toBe('us-east-1')
    expect(email.functionName).toBe('send-email')
    expect(email.functionQualifier).toBe('LIVE')
  })

  it('returns undefined Lambda fields when env vars are absent', () => {
    process.env.ACTIVITIES_EMAIL_TYPE = 'lambda'
    process.env.ACTIVITIES_EMAIL_FROM = 'noreply@example.com'
    // Lambda-specific env vars intentionally absent

    const config = getEmailConfig()
    const email = config?.email as { region?: string; functionName?: string; functionQualifier?: string }

    expect(email.region).toBeUndefined()
    expect(email.functionName).toBeUndefined()
    expect(email.functionQualifier).toBeUndefined()
  })

  it('returns undefined serviceFromAddress when ACTIVITIES_EMAIL_FROM is absent', () => {
    process.env.ACTIVITIES_EMAIL_TYPE = 'resend'
    process.env.ACTIVITIES_EMAIL_RESEND_TOKEN = 're_abc123'
    // ACTIVITIES_EMAIL_FROM intentionally absent

    const config = getEmailConfig()

    expect(config?.email.serviceFromAddress).toBeUndefined()
  })

  it('returns null when ACTIVITIES_EMAIL_TYPE is unknown', () => {
    process.env.ACTIVITIES_EMAIL_TYPE = 'unknown'
    process.env.ACTIVITIES_EMAIL_FROM = 'noreply@example.com'

    const config = getEmailConfig()

    expect(config).toBeNull()
  })
})
