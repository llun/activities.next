import { OpenTelemetryConfig, getOtelConfig } from './opentelemetry'

describe('OpenTelemetry config', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  describe('OpenTelemetryConfig schema', () => {
    it('parses standard config with endpoint', () => {
      const config = OpenTelemetryConfig.parse({
        endpoint: 'https://otel.example.com',
        protocol: 'grpc'
      })

      expect(config.endpoint).toBe('https://otel.example.com')
    })

    it('parses google config', () => {
      const config = OpenTelemetryConfig.parse({
        protocol: 'google'
      })

      expect(config.protocol).toBe('google')
    })
  })

  describe('getOtelConfig', () => {
    it('returns null when no otel env vars', () => {
      const config = getOtelConfig()
      expect(config).toBeNull()
    })

    it('returns config with endpoint', () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://otel.example.com'

      const config = getOtelConfig()

      expect(config).not.toBeNull()
      expect(config?.openTelemetry.endpoint).toBe('https://otel.example.com')
    })

    it('returns google config when protocol is google', () => {
      process.env.OTEL_EXPORTER_OTLP_PROTOCOL = 'google'

      const config = getOtelConfig()

      expect(config).not.toBeNull()
      expect(config?.openTelemetry.protocol).toBe('google')
    })

    it('includes headers when set', () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://otel.example.com'
      process.env.OTEL_EXPORTER_OTLP_HEADERS = 'Authorization=Bearer token'

      const config = getOtelConfig()

      expect(config?.openTelemetry.headers).toBe('Authorization=Bearer token')
    })

    it('returns null when only prefix exists without endpoint or google', () => {
      process.env.OTEL_EXPORTER_ENABLED = 'true'

      const config = getOtelConfig()
      expect(config).toBeNull()
    })
  })
})
