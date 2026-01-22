import { SpanStatusCode, trace } from '@opentelemetry/api'
import { NextRequest } from 'next/server'

import { traceApiRoute } from './traceApiRoute'

describe('traceApiRoute', () => {
  let mockSpan: {
    setAttribute: jest.Mock
    setStatus: jest.Mock
    recordException: jest.Mock
    end: jest.Mock
  }

  beforeEach(() => {
    mockSpan = {
      setAttribute: jest.fn(),
      setStatus: jest.fn(),
      recordException: jest.fn(),
      end: jest.fn()
    }

    // Mock the trace module
    jest.spyOn(trace, 'getTracer').mockReturnValue({
      startSpan: jest.fn().mockReturnValue(mockSpan)
    } as any)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('wraps a successful route handler with tracing', async () => {
    const handler = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200
      })
    )

    const wrapped = traceApiRoute('testRoute', handler)
    const req = new NextRequest('http://localhost/api/test')
    const context = { params: Promise.resolve({}) }

    const response = await wrapped(req, context)

    expect(handler).toHaveBeenCalledWith(req, context)
    expect(mockSpan.setStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.OK
    })
    expect(mockSpan.end).toHaveBeenCalled()
    expect(response.status).toBe(200)
  })

  it('marks span as error for 4xx responses', async () => {
    const handler = jest.fn().mockResolvedValue(
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
    const handler = jest.fn().mockResolvedValue(
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
    const handler = jest.fn().mockRejectedValue(error)

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
    const handler = jest.fn().mockResolvedValue(
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
    const handler = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200
      })
    )

    const startSpanMock = jest.fn().mockReturnValue(mockSpan)
    jest.spyOn(trace, 'getTracer').mockReturnValue({
      startSpan: startSpanMock
    } as any)

    const wrapped = traceApiRoute('testRoute', handler, { op: 'custom' })
    const req = new NextRequest('http://localhost/api/test')
    const context = { params: Promise.resolve({}) }

    await wrapped(req, context)

    expect(startSpanMock).toHaveBeenCalledWith(
      'custom.testRoute',
      expect.any(Object)
    )
  })

  it('skips undefined attributes', async () => {
    const handler = jest.fn().mockResolvedValue(
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
})
