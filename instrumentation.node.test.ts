import { OTLPTraceExporter as GrpcOLTPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc'
import { OTLPTraceExporter as HttpOLTPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { OTLPTraceExporter as ProtoOLTPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getTraceExporter,
  parseHeaders,
  registerNodeInstrumentation
} from './instrumentation.node'
import { Config, getConfig } from './lib/config'

const mockGetRequestHeaders = vi.fn().mockResolvedValue(
  new Headers({
    authorization: 'Bearer mock-google-token'
  })
)
const mockGetClient = vi.fn().mockResolvedValue({
  getRequestHeaders: mockGetRequestHeaders
})

vi.mock('google-auth-library', () => {
  return {
    GoogleAuth: vi.fn().mockImplementation(function (this: unknown) {
      return {
        getClient: mockGetClient
      }
    })
  }
})
vi.mock('@opentelemetry/exporter-trace-otlp-grpc')
vi.mock('@opentelemetry/exporter-trace-otlp-http')
vi.mock('@opentelemetry/exporter-trace-otlp-proto')
vi.mock('@opentelemetry/sdk-node')
vi.mock('./lib/config', () => ({
  getConfig: vi.fn()
}))

describe('instrumentation.node', () => {
  describe('parseHeaders', () => {
    it('returns undefined for empty/undefined input', () => {
      expect(parseHeaders()).toBeUndefined()
      expect(parseHeaders('')).toBeUndefined()
    })

    it('parses single header', () => {
      expect(parseHeaders('Authorization=Bearer token')).toEqual({
        Authorization: 'Bearer token'
      })
    })

    it('parses multiple headers', () => {
      expect(
        parseHeaders('Authorization=Bearer token,X-Custom-Header=value')
      ).toEqual({
        Authorization: 'Bearer token',
        'X-Custom-Header': 'value'
      })
    })

    it('handles values with equal signs', () => {
      expect(parseHeaders('Key=value=with=equals,Another=simple')).toEqual({
        Key: 'value=with=equals',
        Another: 'simple'
      })
    })
  })

  describe('getTraceExporter', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('returns null when openTelemetry config is not set', () => {
      const config = {} as Config
      expect(getTraceExporter(config)).toBeNull()
    })

    it('instantiates GrpcOLTPTraceExporter for grpc protocol', () => {
      const config = {
        openTelemetry: {
          protocol: 'grpc',
          endpoint: 'localhost:4317',
          headers: 'auth=token'
        }
      } as Config

      getTraceExporter(config)

      expect(GrpcOLTPTraceExporter).toHaveBeenCalledWith({
        url: 'localhost:4317',
        headers: { auth: 'token' }
      })
    })

    it('instantiates HttpOLTPTraceExporter for http/json protocol', () => {
      const config = {
        openTelemetry: {
          protocol: 'http/json',
          endpoint: 'http://localhost:4318/v1/traces',
          headers: 'auth=token'
        }
      } as Config

      getTraceExporter(config)

      expect(HttpOLTPTraceExporter).toHaveBeenCalledWith({
        url: 'http://localhost:4318/v1/traces',
        headers: { auth: 'token' }
      })
    })

    it('instantiates ProtoOLTPTraceExporter with google telemetry endpoint and dynamic auth headers for google protocol', async () => {
      const config = {
        openTelemetry: {
          protocol: 'google'
        }
      } as Config

      getTraceExporter(config)

      expect(ProtoOLTPTraceExporter).toHaveBeenCalledWith({
        url: 'https://telemetry.googleapis.com/v1/traces',
        headers: expect.any(Function)
      })

      const callArgs = vi.mocked(ProtoOLTPTraceExporter).mock.calls[0][0] as {
        url: string
        headers: () => Promise<Record<string, string>>
      }
      const headers = await callArgs.headers()
      expect(headers).toEqual({
        authorization: 'Bearer mock-google-token'
      })
    })

    it('uses custom endpoint and merges custom headers for google protocol when provided', async () => {
      const config = {
        openTelemetry: {
          protocol: 'google',
          endpoint: 'https://custom.telemetry.googleapis.com/v1/traces',
          headers: 'X-Custom-Header=value'
        }
      } as Config

      getTraceExporter(config)

      expect(ProtoOLTPTraceExporter).toHaveBeenCalledWith({
        url: 'https://custom.telemetry.googleapis.com/v1/traces',
        headers: expect.any(Function)
      })

      const callArgs = vi.mocked(ProtoOLTPTraceExporter).mock.calls[0][0] as {
        url: string
        headers: () => Promise<Record<string, string>>
      }
      const headers = await callArgs.headers()
      expect(headers).toEqual({
        authorization: 'Bearer mock-google-token',
        'X-Custom-Header': 'value'
      })
    })

    it('instantiates ProtoOLTPTraceExporter for http/protobuf protocol or default', () => {
      const config = {
        openTelemetry: {
          protocol: 'http/protobuf',
          endpoint: 'http://localhost:4318/v1/traces'
        }
      } as Config

      getTraceExporter(config)

      expect(ProtoOLTPTraceExporter).toHaveBeenCalledWith({
        url: 'http://localhost:4318/v1/traces'
      })
    })
  })

  describe('registerNodeInstrumentation', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('does nothing when exporter is null', async () => {
      vi.mocked(getConfig).mockReturnValue({} as Config)

      await registerNodeInstrumentation()

      expect(NodeSDK).not.toHaveBeenCalled()
    })

    it('starts NodeSDK when openTelemetry is configured', async () => {
      const mockStart = vi.fn()
      vi.mocked(NodeSDK).mockImplementation(function (this: unknown) {
        return {
          start: mockStart
        } as unknown as NodeSDK
      } as unknown as typeof NodeSDK)

      vi.mocked(getConfig).mockReturnValue({
        openTelemetry: {
          protocol: 'google'
        }
      } as Config)

      await registerNodeInstrumentation()

      expect(NodeSDK).toHaveBeenCalledTimes(1)
      expect(mockStart).toHaveBeenCalledTimes(1)
    })
  })
})
