import {
  SpanStatusCode,
  TraceFlags,
  context,
  propagation,
  trace
} from '@opentelemetry/api'
import { NextRequest } from 'next/server'

import { getTracer } from './trace'

type RouteHandler<P = unknown> = (
  req: NextRequest,
  context: { params: Promise<P> }
) => Promise<Response>

export interface TraceApiRouteOptions<P = unknown> {
  op?: string
  addAttributes?: (
    req: NextRequest,
    context: { params: Promise<P> }
  ) =>
    | Promise<Record<string, string | number | boolean>>
    | Record<string, string | number | boolean>
}

export const parseCloudTraceContext = (
  header: string
): {
  traceId: string
  spanId: string
  traceFlags: number
  isRemote: boolean
} | null => {
  const match = header.match(
    /^([0-9a-fA-F]{32})(?:\/([0-9]+))?(?:;o=([0-9]+))?/
  )
  if (!match) return null
  const [, traceId, spanIdDec, options] = match
  let spanId = '0000000000000000'
  if (spanIdDec) {
    try {
      spanId = BigInt(spanIdDec).toString(16).padStart(16, '0')
    } catch {
      spanId = '0000000000000000'
    }
  }
  const isSampled = options === '1'
  return {
    traceId: traceId.toLowerCase(),
    spanId: spanId.toLowerCase(),
    traceFlags: isSampled ? TraceFlags.SAMPLED : TraceFlags.NONE,
    isRemote: true
  }
}

// DELIBERATE TRUST DECISION — remote trace context is honored unverified,
// on EVERY route this wraps, public and authenticated alike (the vast
// majority of this app's `app/api/**` routes, plus the ActivityPub inbox and
// other unauthenticated federation surfaces). Any caller can set a
// `traceparent` or `X-Cloud-Trace-Context` header naming an arbitrary trace
// id and a "sampled" flag, and both are bound as this request's parent
// context below with no authentication or signature check.
//
// The accepted risk: a caller can make this app's spans for that request
// correlate under a trace id of the caller's choosing, and can HINT that the
// trace should be sampled. Whether that hint is actually honored is decided
// by whichever OTel SDK/collector an operator attaches externally (this repo
// depends only on `@opentelemetry/api` — see the `OTEL_EXPORTER_*` table in
// `docs/environment-variables.md` — and registers no SDK, sampler, or
// exporter of its own), but the OTel SDK ecosystem's long-standing default is
// a `ParentBased` sampler, which DOES honor an incoming sampled flag. So on a
// default setup, a high-volume anonymous caller could inflate sampled span
// volume against a cost-bearing trace backend (e.g. Google Cloud Trace,
// which this app has first-class support for via `OTEL_EXPORTER_OTLP_PROTOCOL
// =google`).
//
// This is honored anyway, deliberately, rather than stripped for
// "unauthenticated" routes, for two reasons. First, honoring the incoming
// context is the entire point of W3C Trace Context propagation: it is what
// lets legitimate infrastructure in front of this app (a reverse proxy, a
// load balancer, or — on Cloud Run specifically — the platform's own
// front end) correlate a request across hops; refusing it outright would
// break that correlation for every deployment that propagates traces
// correctly, to defend against one that does not. Second, `traceApiRoute`
// wraps handlers uniformly with no signal, at this layer, for whether a
// given route will end up requiring authentication — that check runs
// *inside* the handler, after this context has already been extracted — so
// a "public vs authenticated" split here would need a broader design change
// (e.g. an explicit flag threaded through every one of this app's route
// wrappers) than this fix's scope justifies, and an incomplete or guessed
// split (e.g. inferred from the route path) would be worse than the status
// quo. An operator who needs to bound this risk on a cost-bearing backend
// should do so at the sampler layer they control — e.g. a `ParentBased`
// sampler configured with `remoteParentSampled: alwaysOff` — since that is
// where the actual export/ingestion (and billing) decision is made, not
// here.
export const extractTraceContext = (req: NextRequest) => {
  const activeCtx = context.active()
  if (!req.headers) return activeCtx

  // Extract standard W3C traceparent / tracestate / baggage
  const extractedCtx = propagation.extract(activeCtx, req.headers, {
    get(carrier, key) {
      return carrier.get(key) ?? undefined
    },
    keys(carrier) {
      const keys: string[] = []
      carrier.forEach((_, key) => keys.push(key))
      return keys
    }
  })

  // Check for Google Cloud Trace context header (X-Cloud-Trace-Context)
  const cloudTraceHeader = req.headers.get('x-cloud-trace-context')
  if (cloudTraceHeader) {
    const cloudSpanContext = parseCloudTraceContext(cloudTraceHeader)
    if (cloudSpanContext && trace.isSpanContextValid(cloudSpanContext)) {
      return trace.setSpanContext(extractedCtx, cloudSpanContext)
    }
  }

  return extractedCtx
}

export function traceApiRoute<P = unknown>(
  name: string,
  handler: RouteHandler<P>,
  options: TraceApiRouteOptions<P> = {}
): RouteHandler<P> {
  const { op = 'api', addAttributes } = options

  return (req: NextRequest, routeContext: { params: Promise<P> }) => {
    const parentContext = extractTraceContext(req)
    return context.with(parentContext, () => {
      return getTracer().startActiveSpan(`${op}.${name}`, async (span) => {
        try {
          try {
            const url = req.nextUrl ?? new URL(req.url, 'http://localhost')
            span.setAttribute('http.request.method', req.method)
            span.setAttribute('url.path', url.pathname)
            const query = url.search
              ? url.search.startsWith('?')
                ? url.search.slice(1)
                : url.search
              : ''
            if (query) {
              span.setAttribute('url.query', query)
            }
            const userAgent = req.headers?.get?.('user-agent')
            if (userAgent) {
              span.setAttribute('user_agent.original', userAgent)
            }
          } catch {
            // Tracing failures must never alter request handling
          }

          if (addAttributes) {
            try {
              const attributes = await addAttributes(req, routeContext)
              Object.entries(attributes).forEach(([key, value]) => {
                if (value !== undefined) {
                  span.setAttribute(key, value)
                }
              })
            } catch {
              // Tracing failures must never alter request handling
            }
          }

          const response = await handler(req, routeContext)

          const statusCode = response.status
          try {
            span.setAttribute('http.response.status_code', statusCode)
            span.setAttribute('http.status_code', statusCode)
          } catch {
            // Tracing failures must never alter response handling
          }
          if (statusCode >= 200 && statusCode < 400) {
            span.setStatus({ code: SpanStatusCode.OK })
          } else {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: `HTTP ${statusCode}`
            })
          }

          return response
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error))
          span.recordException(err)
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: err.message
          })
          throw error
        } finally {
          span.end()
        }
      })
    })
  }
}
