import { z } from 'zod'

import { matcher } from './utils'

export const OpenTelemetryProtocol = z.union([
  z.literal('grpc'),
  z.literal('http/protobuf'),
  z.literal('http/json')
])
export type OpenTelemetryProtocol = z.infer<typeof OpenTelemetryProtocol>

export const OpenTelemetryConfig = z.object({
  endpoint: z.string(),
  protocol: OpenTelemetryProtocol.optional(),
  headers: z.string().optional()
})
export type OpenTelemetryConfig = z.infer<typeof OpenTelemetryConfig>

export const getOtelConfig = (): {
  openTelemetry: OpenTelemetryConfig
} | null => {
  const hasEnvironmentOtel = matcher('OTEL_EXPORTER_')
  if (!hasEnvironmentOtel) return null
  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
    process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ||
    process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT
  if (!endpoint) return null
  return {
    openTelemetry: {
      endpoint,
      ...(process.env.OTEL_EXPORTER_OTLP_PROTOCOL
        ? {
            protocol: process.env
              .OTEL_EXPORTER_OTLP_PROTOCOL as OpenTelemetryProtocol
          }
        : null),
      ...(process.env.OTEL_EXPORTER_OTLP_HEADERS
        ? { headers: process.env.OTEL_EXPORTER_OTLP_HEADERS }
        : null)
    }
  }
}
