import { OTLPTraceExporter as GrpcOLTPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc'
import { OTLPTraceExporter as HttpOLTPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { OTLPTraceExporter as ProtoOLTPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { TraceExporter as GoogleCloudTraceExporter } from '@google-cloud/opentelemetry-cloud-trace-exporter'
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http'
import { KnexInstrumentation } from '@opentelemetry/instrumentation-knex'
import { registerOTel } from '@vercel/otel'

import { getConfig, type Config } from './lib/config'
import { TRACE_APPLICATION_SCOPE } from './lib/utils/trace'

const getTraceExporter = (config: Config) => {
    if (!config.openTelemetry) return null
    switch (config.openTelemetry.protocol) {
        case 'grpc':
            return new GrpcOLTPTraceExporter()
        case 'http/json':
            return new HttpOLTPTraceExporter()
        case 'google':
            return new GoogleCloudTraceExporter()
        default:
            return new ProtoOLTPTraceExporter()
    }
}

export const registerNodeInstrumentation = () => {
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
