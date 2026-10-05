import { NextRequest } from 'next/server'

import {
  RequestBodyTooLargeError,
  readRequestBodyWithLimit,
  readRequestTextWithLimit
} from '@/lib/utils/boundedRequestBody'
import { getRequestBody } from '@/lib/utils/getRequestBody'

const post = (body: BodyInit, headers: Record<string, string> = {}) =>
  new NextRequest('https://llun.test/api', { method: 'POST', body, headers })

describe('readRequestBodyWithLimit', () => {
  it('returns a body within the cap', async () => {
    await expect(readRequestTextWithLimit(post('hello'), 16)).resolves.toBe(
      'hello'
    )
  })

  it('returns an empty buffer when there is no body', async () => {
    const req = new NextRequest('https://llun.test/api', { method: 'POST' })
    expect((await readRequestBodyWithLimit(req, 16)).byteLength).toBe(0)
  })

  it('rejects on a declared content-length over the cap without reading', async () => {
    const req = post('tiny', { 'content-length': '999999' })
    await expect(readRequestBodyWithLimit(req, 16)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError
    )
    expect(req.bodyUsed).toBe(false)
  })

  it('enforces the cap on the stream when the header is missing or lies', async () => {
    const req = post('x'.repeat(1000), { 'content-length': '4' })
    await expect(readRequestBodyWithLimit(req, 16)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError
    )
  })

  it('stops reading a chunked body as soon as the cap is crossed', async () => {
    let pulled = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1
        controller.enqueue(new Uint8Array(1024))
        if (pulled > 1000) controller.close()
      }
    })
    const req = new NextRequest('https://llun.test/api', {
      method: 'POST',
      body: stream,
      duplex: 'half'
    } as unknown as ConstructorParameters<typeof NextRequest>[1])
    await expect(readRequestBodyWithLimit(req, 4096)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError
    )
    expect(pulled).toBeLessThan(50)
  })
})

describe('getRequestBody with maxBytes', () => {
  it('parses JSON, urlencoded and multipart bodies within the cap', async () => {
    await expect(
      getRequestBody(
        post('{"a":"b"}', { 'content-type': 'application/json' }),
        { maxBytes: 1024 }
      )
    ).resolves.toEqual({ a: 'b' })
    await expect(
      getRequestBody(
        post('a=b', { 'content-type': 'application/x-www-form-urlencoded' }),
        { maxBytes: 1024 }
      )
    ).resolves.toEqual({ a: 'b' })

    const form = new FormData()
    form.set('a', 'b')
    const multipart = new Request('https://llun.test/api', {
      method: 'POST',
      body: form
    })
    const req = new NextRequest('https://llun.test/api', {
      method: 'POST',
      body: await multipart.arrayBuffer(),
      headers: { 'content-type': multipart.headers.get('content-type')! }
    })
    await expect(getRequestBody(req, { maxBytes: 4096 })).resolves.toEqual({
      a: 'b'
    })
  })

  it.each([
    'application/json',
    'application/x-www-form-urlencoded',
    'multipart/form-data; boundary=x'
  ])('rejects an oversized %s body before parsing', async (contentType) => {
    const req = post('z'.repeat(5000), { 'content-type': contentType })
    await expect(
      getRequestBody(req, { maxBytes: 1024 })
    ).rejects.toBeInstanceOf(RequestBodyTooLargeError)
  })
})
