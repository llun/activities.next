import { TraceExporter as GoogleTraceExporter } from '@google-cloud/opentelemetry-cloud-trace-exporter'
import { DiagConsoleLogger, DiagLogLevel, diag } from '@opentelemetry/api'
import { OTLPTraceExporter as GrpcOLTPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc'
import { OTLPTraceExporter as HttpOLTPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { OTLPTraceExporter as ProtoOLTPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { AwsInstrumentation } from '@opentelemetry/instrumentation-aws-sdk'
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http'
import { KnexInstrumentation } from '@opentelemetry/instrumentation-knex'
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici'
import { Resource } from '@opentelemetry/resources'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-node'
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

const config = getConfig()
const exporter = getTraceExporter(config)
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO)
if (exporter) {
  const sdk = new NodeSDK({
    resource: new Resource({
      [SEMRESATTRS_SERVICE_NAME]: TRACE_APPLICATION_SCOPE,
      [SEMRESATTRS_SERVICE_VERSION]: TRACE_APPLICATION_VERSION,
      [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV
    }),
    spanProcessors: [new BatchSpanProcessor(exporter)],
    instrumentations: [
      new KnexInstrumentation(),
      new HttpInstrumentation(),
      new UndiciInstrumentation(),
      new AwsInstrumentation()
    ]
  })
  try {
    sdk.start()
    diag.info('OpenTelemetry automatic instrumentation started successfully')
  } catch (error) {
    diag.error(
      'Error initializing OpenTelemetry SDK. Your application is not instrumented and will not produce telemetry',
      error
    )
  }

  process.on('SIGTERM', () => {
    sdk
      .shutdown()
      .then(() => diag.debug('OpenTelemetry SDK terminated'))
      .catch((error) => diag.error('Error terminating tracing', error))
      .finally(() => process.exit(0))
  })
}
