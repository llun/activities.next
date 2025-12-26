import { z } from 'zod'

import { matcher } from './utils'

const StandardOpenTelemetryProtocol = z.enum([
  'grpc',
  'http/protobuf',
  'http/json'
])

export const OpenTelemetryProtocol = StandardOpenTelemetryProtocol.or(
  z.literal('google')
)
export type OpenTelemetryProtocol = z.infer<typeof OpenTelemetryProtocol>

export const OpenTelemetryConfig = z.union([
  z.object({
    endpoint: z.string(),
    protocol: StandardOpenTelemetryProtocol.optional(),
    headers: z.string().optional()
  }),
  z.object({
    protocol: z.literal('google'),
    endpoint: z.string().optional(),
    headers: z.string().optional()
  })
])
export type OpenTelemetryConfig = z.infer<typeof OpenTelemetryConfig>

export const getOtelConfig = (): {
  openTelemetry: OpenTelemetryConfig
} | null => {
  const hasEnvironmentOtel = matcher('OTEL_EXPORTER_')
  if (!hasEnvironmentOtel) return null
  const protocol = process.env
    .OTEL_EXPORTER_OTLP_PROTOCOL as OpenTelemetryProtocol | undefined
  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
    process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ||
    process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT
  if (!endpoint && protocol !== 'google') return null
  return {
    openTelemetry: {
      ...(endpoint ? { endpoint } : null),
      ...(protocol ? { protocol } : null),
      ...(process.env.OTEL_EXPORTER_OTLP_HEADERS
        ? { headers: process.env.OTEL_EXPORTER_OTLP_HEADERS }
        : null)
    }
  }
}
