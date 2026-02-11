import { TraceExporter as GoogleCloudTraceExporter } from '@google-cloud/opentelemetry-cloud-trace-exporter'
import { CloudPropagator } from '@google-cloud/opentelemetry-cloud-trace-propagator'
import {
  CompositePropagator,
  W3CTraceContextPropagator
} from '@opentelemetry/core'
import { OTLPTraceExporter as GrpcOLTPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc'
import { OTLPTraceExporter as HttpOLTPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { OTLPTraceExporter as ProtoOLTPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http'
import { KnexInstrumentation } from '@opentelemetry/instrumentation-knex'
import { gcpDetector } from '@opentelemetry/resource-detector-gcp'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions'
import { registerOTel } from '@vercel/otel'

import { type Config, getConfig } from './lib/config'
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

export const registerNodeInstrumentation = async () => {
  const config = getConfig()
  const exporter = getTraceExporter(config)

  if (exporter) {
    if (config.openTelemetry?.protocol === 'google') {
      const sdk = new NodeSDK({
        resource: resourceFromAttributes({
          [SemanticResourceAttributes.SERVICE_NAME]: TRACE_APPLICATION_SCOPE,
          environment: process.env.NODE_ENV
        }),
        resourceDetectors: [gcpDetector],
        traceExporter: exporter,
        textMapPropagator: new CompositePropagator({
          propagators: [new W3CTraceContextPropagator(), new CloudPropagator()]
        }),
        instrumentations: [new KnexInstrumentation(), new HttpInstrumentation()]
      })
      sdk.start()
    } else {
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
}
