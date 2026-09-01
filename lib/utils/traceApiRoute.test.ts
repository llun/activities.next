import {
  SpanContext,
  SpanStatusCode,
  TextMapPropagator,
  Tracer,
  propagation,
  trace
} from '@opentelemetry/api'
import { NextRequest } from 'next/server'

import { setupRecordingTracer } from '@/lib/testing/recordingTracer'

import { parseCloudTraceContext, traceApiRoute } from './traceApiRoute'

// A minimal, spec-shaped W3C `traceparent` propagator used ONLY to exercise
// `extractTraceContext`'s call to `propagation.extract()` in tests below.
// Without *some* propagator registered, `propagation.extract()` is a no-op
// by default (`NoopTextMapPropagator`), so a `traceparent` header would never
// actually bind to context — production relies on an OTel SDK registering
// the real `W3CTraceContextPropagator` (from `@opentelemetry/core`, which is
// not a declared dependency of this repo). Tests build minimal fakes against
// the `@opentelemetry/api` interfaces instead, the same way
// `lib/testing/recordingTracer.ts` builds a fake tracer/context manager.
const w3cTraceparentPropagator: TextMapPropagator = {
  inject: () => {
    // Not exercised by these tests — traceApiRoute only extracts.
  },
  fields: () => ['traceparent'],
  extract: (activeCtx, carrier, getter) => {
    const header = getter.get(carrier, 'traceparent')
    if (typeof header !== 'string') return activeCtx
    const match = header.match(
      /^[0-9a-f]{2}-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i
    )
    if (!match) return activeCtx
    const [, traceId, spanId, flagsHex] = match
    const spanContext: SpanContext = {
      traceId,
      spanId,
      traceFlags: parseInt(flagsHex, 16),
      isRemote: true
    }
    if (!trace.isSpanContextValid(spanContext)) return activeCtx
    return trace.setSpanContext(activeCtx, spanContext)
  }
}

describe('parseCloudTraceContext', () => {
  it('parses traceId, decimal spanId, and sampled flag', () => {
    const traceId = '02dad5002ab305f1fd75ae8bd0d46e94'
    const hexSpanId = '3ca938408dc381d3'
    const decSpanId = BigInt(`0x${hexSpanId}`).toString(10)
    const header = `${traceId}/${decSpanId};o=1`
    const result = parseCloudTraceContext(header)
    expect(result).toEqual({
      traceId,
      spanId: hexSpanId,
      traceFlags: 1,
      isRemote: true
    })
  })

  it('parses header without options', () => {
    const traceId = '02dad5002ab305f1fd75ae8bd0d46e94'
    const hexSpanId = '3ca938408dc381d3'
    const decSpanId = BigInt(`0x${hexSpanId}`).toString(10)
    const header = `${traceId}/${decSpanId}`
    const result = parseCloudTraceContext(header)
    expect(result).toEqual({
      traceId,
      spanId: hexSpanId,
      traceFlags: 0,
      isRemote: true
    })
  })

  it('returns null for invalid header', () => {
    expect(parseCloudTraceContext('invalid')).toBeNull()
  })
})

describe('traceApiRoute', () => {
  let mockSpan: {
    setAttribute: jest.Mock
    setStatus: jest.Mock
    recordException: jest.Mock
    end: jest.Mock
  }

  beforeEach(() => {
    mockSpan = {
      setAttribute: vi.fn(),
      setStatus: vi.fn(),
      recordException: vi.fn(),
      end: vi.fn()
    }

    // Mock the trace module
    vi.spyOn(trace, 'getTracer').mockReturnValue({
      startActiveSpan: vi.fn().mockImplementation((_name, fn) => fn(mockSpan))
    } as unknown as Tracer)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('wraps a successful route handler with tracing and sets HTTP attributes', async () => {
    const handler = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200
      })
    )

    const wrapped = traceApiRoute('testRoute', handler)
    const req = new NextRequest('http://localhost/api/test?limit=100', {
      headers: {
        'user-agent': 'TestAgent/1.0'
      }
    })
    const context = { params: Promise.resolve({}) }

    const response = await wrapped(req, context)

    expect(handler).toHaveBeenCalledWith(req, context)
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      'http.request.method',
      'GET'
    )
    expect(mockSpan.setAttribute).toHaveBeenCalledWith('url.path', '/api/test')
    expect(mockSpan.setAttribute).toHaveBeenCalledWith('url.query', 'limit=100')
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      'user_agent.original',
      'TestAgent/1.0'
    )
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      'http.response.status_code',
      200
    )
    expect(mockSpan.setAttribute).toHaveBeenCalledWith('http.status_code', 200)
    expect(mockSpan.setStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.OK
    })
    expect(mockSpan.end).toHaveBeenCalled()
    expect(response.status).toBe(200)
  })

  it('marks span as error for 4xx responses', async () => {
    const handler = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404
      })
    )

    const wrapped = traceApiRoute('testRoute', handler)
    const req = new NextRequest('http://localhost/api/test')
    const context = { params: Promise.resolve({}) }

    const response = await wrapped(req, context)

    expect(mockSpan.setStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.ERROR,
      message: 'HTTP 404'
    })
    expect(mockSpan.end).toHaveBeenCalled()
    expect(response.status).toBe(404)
  })

  it('marks span as error for 5xx responses', async () => {
    const handler = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Internal error' }), {
        status: 500
      })
    )

    const wrapped = traceApiRoute('testRoute', handler)
    const req = new NextRequest('http://localhost/api/test')
    const context = { params: Promise.resolve({}) }

    const response = await wrapped(req, context)

    expect(mockSpan.setStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.ERROR,
      message: 'HTTP 500'
    })
    expect(mockSpan.end).toHaveBeenCalled()
    expect(response.status).toBe(500)
  })

  it('records exceptions when handler throws', async () => {
    const error = new Error('Test error')
    const handler = vi.fn().mockRejectedValue(error)

    const wrapped = traceApiRoute('testRoute', handler)
    const req = new NextRequest('http://localhost/api/test')
    const context = { params: Promise.resolve({}) }

    await expect(wrapped(req, context)).rejects.toThrow('Test error')

    expect(mockSpan.recordException).toHaveBeenCalledWith(error)
    expect(mockSpan.setStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.ERROR,
      message: 'Test error'
    })
    expect(mockSpan.end).toHaveBeenCalled()
  })

  it('adds custom attributes when provided', async () => {
    const handler = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200
      })
    )

    const wrapped = traceApiRoute('testRoute', handler, {
      addAttributes: async () => ({
        userId: '123',
        method: 'GET',
        hasAuth: true
      })
    })

    const req = new NextRequest('http://localhost/api/test')
    const context = { params: Promise.resolve({}) }

    await wrapped(req, context)

    expect(mockSpan.setAttribute).toHaveBeenCalledWith('userId', '123')
    expect(mockSpan.setAttribute).toHaveBeenCalledWith('method', 'GET')
    expect(mockSpan.setAttribute).toHaveBeenCalledWith('hasAuth', true)
  })

  it('uses custom op when provided', async () => {
    const handler = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200
      })
    )

    const startActiveSpanMock = vi
      .fn()
      .mockImplementation((_name, fn) => fn(mockSpan))
    vi.spyOn(trace, 'getTracer').mockReturnValue({
      startActiveSpan: startActiveSpanMock
    } as unknown as Tracer)

    const wrapped = traceApiRoute('testRoute', handler, { op: 'custom' })
    const req = new NextRequest('http://localhost/api/test')
    const context = { params: Promise.resolve({}) }

    await wrapped(req, context)

    expect(startActiveSpanMock).toHaveBeenCalledWith(
      'custom.testRoute',
      expect.any(Function)
    )
  })

  it('skips undefined attributes', async () => {
    const handler = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200
      })
    )

    const wrapped = traceApiRoute('testRoute', handler, {
      addAttributes: async () => ({
        userId: '123',
        optional: undefined
      })
    })

    const req = new NextRequest('http://localhost/api/test')
    const context = { params: Promise.resolve({}) }

    await wrapped(req, context)

    expect(mockSpan.setAttribute).toHaveBeenCalledWith('userId', '123')
    expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(
      'optional',
      undefined
    )
  })

  // The "extracts …" test above (and this block's two tests, before they
  // were strengthened) only asserted a 200 response and that the handler
  // ran — which would pass even if the extracted trace context (W3C
  // `traceparent` or `X-Cloud-Trace-Context`) were parsed and then silently
  // discarded rather than bound as the active context. The block below
  // instead captures the ACTIVE SPAN CONTEXT observed from *inside* the handler and
  // asserts it descends from the injected header, which is the only way to
  // prove `context.with(parentContext, …)` actually threaded the extracted
  // context through to the wrapped handler.
  //
  // This needs a REAL context manager and tracer, not the `mockSpan` stub
  // used by every other test in this file: that stub's `startActiveSpan`
  // never calls `context.with()`, so `trace.getActiveSpan()` inside the
  // handler would read whatever the environment's context manager reports —
  // which, with no context manager registered (the default), is always
  // `undefined` regardless of whether propagation actually worked. Swap in
  // `setupRecordingTracer()` (a real in-memory context manager + tracer,
  // built only against `@opentelemetry/api`) for this block instead.
  describe('active span context propagation', () => {
    let harness: ReturnType<typeof setupRecordingTracer>

    beforeEach(() => {
      // Undo the outer `beforeEach`'s `trace.getTracer` stub first — it
      // shadows the real `trace.getTracer`, which `setupRecordingTracer()`
      // needs untouched so it can register its own global tracer provider.
      vi.restoreAllMocks()
      harness = setupRecordingTracer()
      propagation.setGlobalPropagator(w3cTraceparentPropagator)
    })

    afterEach(() => {
      propagation.disable()
      harness.cleanup()
    })

    it('extracts W3C traceparent header and binds it as the active span context inside the handler', async () => {
      let capturedSpanContext: SpanContext | undefined
      const handler = vi.fn().mockImplementation(async () => {
        capturedSpanContext = trace.getActiveSpan()?.spanContext()
        return new Response(JSON.stringify({ success: true }), {
          status: 200
        })
      })

      const wrapped = traceApiRoute('testRoute', handler)
      const traceId = '02dad5002ab305f1fd75ae8bd0d46e94'
      const spanId = '3ca938408dc381d3'
      const req = new NextRequest('http://localhost/api/test', {
        headers: {
          traceparent: `00-${traceId}-${spanId}-01`
        }
      })
      const context = { params: Promise.resolve({}) }

      const response = await wrapped(req, context)
      expect(response.status).toBe(200)
      expect(handler).toHaveBeenCalled()

      // The span active INSIDE the handler must descend from the extracted
      // remote span: same trace id, and parented on the injected span id.
      expect(capturedSpanContext?.traceId).toBe(traceId)
      expect(harness.recordedSpans).toHaveLength(1)
      expect(harness.recordedSpans[0].parentSpanId).toBe(spanId)
      expect(harness.recordedSpans[0].name).toBe('api.testRoute')
    })

    it('extracts Google Cloud X-Cloud-Trace-Context header and binds it as the active span context inside the handler', async () => {
      let capturedSpanContext: SpanContext | undefined
      const handler = vi.fn().mockImplementation(async () => {
        capturedSpanContext = trace.getActiveSpan()?.spanContext()
        return new Response(JSON.stringify({ success: true }), {
          status: 200
        })
      })

      const wrapped = traceApiRoute('testRoute', handler)
      const traceId = '02dad5002ab305f1fd75ae8bd0d46e94'
      const hexSpanId = '3ca938408dc381d3'
      const decSpanId = BigInt(`0x${hexSpanId}`).toString(10)
      const req = new NextRequest('http://localhost/api/test', {
        headers: {
          'x-cloud-trace-context': `${traceId}/${decSpanId};o=1`
        }
      })
      const context = { params: Promise.resolve({}) }

      const response = await wrapped(req, context)
      expect(response.status).toBe(200)
      expect(handler).toHaveBeenCalled()

      expect(capturedSpanContext?.traceId).toBe(traceId)
      expect(harness.recordedSpans).toHaveLength(1)
      expect(harness.recordedSpans[0].parentSpanId).toBe(hexSpanId)
      expect(harness.recordedSpans[0].name).toBe('api.testRoute')
    })
  })
})
