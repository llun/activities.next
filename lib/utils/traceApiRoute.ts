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
    | Promise<Record<string, string | number | boolean | undefined>>
    | Record<string, string | number | boolean | undefined>
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

// Query parameter name parts that carry a credential or PII: OAuth `code` /
// `state` / tokens on callbacks, Strava's `hub.verify_token`, share tokens, and
// the like. The name is split on `.`, `_`, `-` and brackets and redacted when
// any part matches, so `access_token`, `hub.verify_token`, `client_secret`
// and `code_verifier` are all caught. Over-redacting a harmless parameter
// costs a debugging hint; under-redacting exports a credential.
const SENSITIVE_QUERY_NAME_PARTS = new Set([
  'assertion',
  'code',
  'email',
  'key',
  'nonce',
  'otp',
  'password',
  'secret',
  'sig',
  'signature',
  'state',
  'token',
  'verifier'
])
const REDACTED = 'REDACTED'
const MAX_TRACE_QUERY_LENGTH = 2048

const isSensitiveQueryName = (name: string) =>
  name
    .toLowerCase()
    .split(/[._\-[\]]+/)
    .some((part) => SENSITIVE_QUERY_NAME_PARTS.has(part))

/**
 * The query string as recorded on the span: sensitive parameter values are
 * replaced (their names are kept, which is the debugging signal) and the result
 * is bounded. Spans leave the process through whatever exporter an operator
 * attaches, so they must not carry credentials the request happened to hold.
 */
export const redactTraceQuery = (search: string): string => {
  const params = new URLSearchParams(search)
  const redacted = new URLSearchParams()
  params.forEach((value, name) => {
    redacted.append(name, isSensitiveQueryName(name) ? REDACTED : value)
  })
  return redacted.toString().slice(0, MAX_TRACE_QUERY_LENGTH)
}

/**
 * The path as recorded on the span, with every dynamic route segment replaced
 * by its parameter name (`/api/v1/webhooks/strava/[webhookToken]`). Some
 * routes carry a bearer-style credential as a path segment — the Strava webhook
 * token, heatmap share tokens — and the wrapper cannot know which, so no
 * concrete parameter value is recorded; a route that wants an id on its span
 * adds it explicitly through `addAttributes`.
 */
export const templateTracePath = (
  pathname: string,
  params: unknown
): string => {
  if (!params || typeof params !== 'object') return pathname
  const names = new Map<string, string>()
  for (const [name, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item === 'string' && item) names.set(item, name)
    }
  }
  if (names.size === 0) return pathname
  return pathname
    .split('/')
    .map((segment) => {
      let decoded = segment
      try {
        decoded = decodeURIComponent(segment)
      } catch {
        // Keep the raw segment
      }
      const name = names.get(decoded) ?? names.get(segment)
      return name ? `[${name}]` : segment
    })
    .join('/')
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
            span.setAttribute(
              'url.path',
              templateTracePath(url.pathname, await routeContext?.params)
            )
            const query = url.search ? redactTraceQuery(url.search) : ''
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
