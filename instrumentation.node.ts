import { TraceExporter as GoogleTraceExporter } from '@google-cloud/opentelemetry-cloud-trace-exporter'
import opentelemetryAPI, {
  DiagConsoleLogger,
  DiagLogLevel
} from '@opentelemetry/api'
import { OTLPTraceExporter as GrpcOLTPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc'
import { OTLPTraceExporter as HttpOLTPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { OTLPTraceExporter as ProtoOLTPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http'
import { KnexInstrumentation } from '@opentelemetry/instrumentation-knex'
import { Resource } from '@opentelemetry/resources'
import { NodeSDK } from '@opentelemetry/sdk-node'
import {
  BatchSpanProcessor,
  NodeTracerProvider
} from '@opentelemetry/sdk-trace-node'
import {
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT,
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION
} from '@opentelemetry/semantic-conventions'

import { Config, getConfig } from './lib/config'
import {
  TRACE_APPLICATION_SCOPE,
  TRACE_APPLICATION_VERSION
} from './lib/utils/trace'

const getTraceExporter = (config: Config) => {
  if (!config.openTelemetry) return null
  switch (config.openTelemetry.protocol) {
    case 'grpc':
      return new GrpcOLTPTraceExporter()
    case 'http/json':
      return new HttpOLTPTraceExporter()
    case 'google':
      return new GoogleTraceExporter()
    default:
      return new ProtoOLTPTraceExporter()
  }
}

opentelemetryAPI.diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN)
const config = getConfig()
const exporter = getTraceExporter(config)
console.log('OpenTelemetry protocol = ', config.openTelemetry?.protocol)
if (exporter) {
  if (config.openTelemetry?.protocol === 'google') {
    const provider = new NodeTracerProvider({
      resource: new Resource({
        [SEMRESATTRS_SERVICE_NAME]: TRACE_APPLICATION_SCOPE,
        [SEMRESATTRS_SERVICE_VERSION]: TRACE_APPLICATION_VERSION,
        [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV
      })
    })
    registerInstrumentations({
      tracerProvider: provider,
      instrumentations: [new KnexInstrumentation(), new HttpInstrumentation()]
    })

    provider.addSpanProcessor(new BatchSpanProcessor(exporter))

    // Initialize the OpenTelemetry APIs to use the NodeTracerProvider bindings
    provider.register()
  } else {
    const sdk = new NodeSDK({
      resource: new Resource({
        [SEMRESATTRS_SERVICE_NAME]: TRACE_APPLICATION_SCOPE,
        [SEMRESATTRS_SERVICE_VERSION]: TRACE_APPLICATION_VERSION,
        [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV
      }),
      spanProcessors: [new BatchSpanProcessor(exporter)],
      instrumentations: [new KnexInstrumentation(), new HttpInstrumentation()]
    })
    sdk.start()
    process.on('SIGTERM', () => {
      sdk
        .shutdown()
        .then(() => console.log('Tracing terminated'))
        .catch((error) => console.log('Error terminating tracing', error))
        .finally(() => process.exit(0))
    })
  }
}
