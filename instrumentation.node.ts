import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator
} from '@opentelemetry/core'
import { OTLPTraceExporter as GrpcOLTPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc'
import { OTLPTraceExporter as HttpOLTPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { OTLPTraceExporter as ProtoOLTPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http'
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici'
import { gcpDetector } from '@opentelemetry/resource-detector-gcp'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { NodeSDK } from '@opentelemetry/sdk-node'
import {
  AlwaysOnSampler,
  SimpleSpanProcessor
} from '@opentelemetry/sdk-trace-base'
import { GoogleAuth } from 'google-auth-library'

import { type Config, getConfig } from './lib/config'
import { logger } from './lib/utils/logger'
import { TRACE_APPLICATION_SCOPE } from './lib/utils/trace'

export const parseHeaders = (
  headers?: string
): Record<string, string> | undefined => {
  if (!headers) return undefined
  const result: Record<string, string> = {}
  for (const pair of headers.split(',')) {
    const [rawKey, ...rawVal] = pair.split('=')
    const key = rawKey?.trim()
    const val = rawVal.join('=').trim()
    if (key && val) {
      result[key] = val
    }
  }
  return Object.keys(result).length > 0 ? result : undefined
}

export const getTraceExporter = (config: Config) => {
  if (!config.openTelemetry) return null
  const { protocol, endpoint, headers } = config.openTelemetry
  const parsedHeaders = parseHeaders(headers)
  const options = {
    ...(endpoint ? { url: endpoint } : {}),
    ...(parsedHeaders ? { headers: parsedHeaders } : {})
  }

  switch (protocol) {
    case 'grpc':
      return new GrpcOLTPTraceExporter(options)
    case 'http/json':
      return new HttpOLTPTraceExporter(options)
    case 'google': {
      let authClient: Awaited<ReturnType<GoogleAuth['getClient']>> | null = null
      const url = endpoint ?? 'https://telemetry.googleapis.com/v1/traces'
      return new ProtoOLTPTraceExporter({
        url,
        headers: async () => {
          if (!authClient) {
            const auth = new GoogleAuth({
              scopes: 'https://www.googleapis.com/auth/cloud-platform'
            })
            authClient = await auth.getClient()
          }
          const rawHeaders = await authClient.getRequestHeaders(url)
          const authHeaders =
            rawHeaders instanceof Headers
              ? Object.fromEntries(rawHeaders.entries())
              : typeof (rawHeaders as { entries?: unknown })?.entries ===
                  'function'
                ? Object.fromEntries(
                    (
                      rawHeaders as {
                        entries: () => Iterable<[string, string]>
                      }
                    ).entries()
                  )
                : ((rawHeaders ?? {}) as Record<string, string>)
          return {
            ...authHeaders,
            ...(parsedHeaders ?? {})
          }
        }
      })
    }
    case 'http/protobuf':
    default:
      return new ProtoOLTPTraceExporter(options)
  }
}

let sdk: NodeSDK | null = null

export const registerNodeInstrumentation = async () => {
  const config = getConfig()
  const exporter = getTraceExporter(config)

  if (!exporter) return

  const isGoogle = config.openTelemetry?.protocol === 'google'
  const spanProcessor = new SimpleSpanProcessor(exporter)

  let projectId: string | null = null
  if (isGoogle) {
    const auth = new GoogleAuth({
      scopes: 'https://www.googleapis.com/auth/cloud-platform'
    })
    projectId = await auth.getProjectId().catch(() => null)
  }

  sdk = new NodeSDK({
    sampler: new AlwaysOnSampler(),
    resource: resourceFromAttributes({
      'service.name': TRACE_APPLICATION_SCOPE,
      environment: process.env.NODE_ENV,
      ...(projectId ? { 'gcp.project_id': projectId } : {})
    }),
    ...(isGoogle ? { resourceDetectors: [gcpDetector] } : {}),
    spanProcessors: [spanProcessor],
    textMapPropagator: new CompositePropagator({
      propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()]
    }),
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => {
          const url = req.url ?? ''
          return (
            url.startsWith('/_next/') ||
            url === '/health' ||
            url === '/manifest.webmanifest' ||
            url.startsWith('/static/')
          )
        }
      }),
      new UndiciInstrumentation()
    ]
  })

  sdk.start()

  const shutdown = () => {
    if (sdk) {
      sdk
        .shutdown()
        .then(() => {
          logger.info('OpenTelemetry SDK shut down successfully')
          process.exit(0)
        })
        .catch((err) => {
          logger.error({ err }, 'Error shutting down OpenTelemetry SDK')
          process.exit(1)
        })
    }
  }

  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
}
