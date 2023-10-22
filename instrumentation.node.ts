import { OTLPTraceExporter as GrpcOLTPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc'
import { OTLPTraceExporter as HttpOLTPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { OTLPTraceExporter as ProtoOLTPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { Resource } from '@opentelemetry/resources'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node'
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions'

import { Config, getConfig } from './lib/config'
import { TRACE_APPLICATION_SCOPE, TRACE_APPLICATION_VERSION } from './lib/trace'

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

const config = getConfig()
const exporter = getTraceExporter(config)
if (exporter) {
  const sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: TRACE_APPLICATION_SCOPE,
      [SemanticResourceAttributes.SERVICE_VERSION]: TRACE_APPLICATION_VERSION,
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV
    }),
    spanProcessor: new SimpleSpanProcessor(exporter)
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
