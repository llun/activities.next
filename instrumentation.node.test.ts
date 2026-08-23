import { TraceExporter as GoogleCloudTraceExporter } from '@google-cloud/opentelemetry-cloud-trace-exporter'
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

vi.mock('@google-cloud/opentelemetry-cloud-trace-exporter')
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

    it('instantiates GoogleCloudTraceExporter for google protocol', () => {
      const config = {
        openTelemetry: {
          protocol: 'google'
        }
      } as Config

      getTraceExporter(config)

      expect(GoogleCloudTraceExporter).toHaveBeenCalledWith()
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
