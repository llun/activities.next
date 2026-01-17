import { SpanStatusCode, trace } from '@opentelemetry/api'
import { OTLPTraceExporter as GrpcOLTPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc'
import { OTLPTraceExporter as HttpOLTPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { OTLPTraceExporter as ProtoOLTPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http'
import { KnexInstrumentation } from '@opentelemetry/instrumentation-knex'
import { registerOTel } from '@vercel/otel'
import { type Instrumentation } from 'next'

import { Config, getConfig } from './lib/config'
import { TRACE_APPLICATION_SCOPE } from './lib/utils/trace'

const getTraceExporter = (config: Config) => {
  if (!config.openTelemetry) return null
  switch (config.openTelemetry.protocol) {
    case 'grpc':
      return new GrpcOLTPTraceExporter()
    case 'http/json':
      return new HttpOLTPTraceExporter()
    default:
      return new ProtoOLTPTraceExporter()
  }
}

export const register = () => {
  const config = getConfig()
  const exporter = getTraceExporter(config)

  if (exporter) {
    registerOTel({
      serviceName: TRACE_APPLICATION_SCOPE,
      attributes: {
        environment: process.env.NODE_ENV
      },
      traceExporter: exporter,
      instrumentations: [new KnexInstrumentation(), new HttpInstrumentation()]
    })
  }
}

export const onRequestError: Instrumentation.onRequestError = async (
  err,
  _request,
  _context
) => {
  const span = trace.getActiveSpan()
  if (span) {
    if (err instanceof Error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err.message
      })
      span.recordException(err)
    } else {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: String(err)
      })
      span.recordException(String(err))
    }
  }
}
