import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { Resource } from '@opentelemetry/resources'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node'
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions'

import { TRACE_APPLICATION_SCOPE, TRACE_APPLICATION_VERSION } from './lib/trace'

const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: TRACE_APPLICATION_SCOPE,
    [SemanticResourceAttributes.SERVICE_VERSION]: TRACE_APPLICATION_VERSION
  }),
  spanProcessor: new SimpleSpanProcessor(new OTLPTraceExporter())
})
sdk.start()
