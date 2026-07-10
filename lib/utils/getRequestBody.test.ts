import { NextRequest } from 'next/server'

import { getRequestBody } from './getRequestBody'

const createMockRequest = (
  url: string,
  contentType?: string,
  body?: unknown
): NextRequest => {
  const headers = new Headers()
  if (contentType) {
    headers.set('content-type', contentType)
  }

  const entries = Object.entries(body || {})

  // Mirror a real NextRequest: text() returns the raw body serialized to match
  // the content type (JSON for application/json, urlencoded otherwise).
  const isJson = (contentType || '').includes('application/json')
  const rawText = isJson
    ? JSON.stringify(body ?? {})
    : new URLSearchParams(
        entries.map(([key, value]) => [key, String(value)])
      ).toString()

  const request = {
    url,
    headers,
    formData: vi
      .fn()
      .mockResolvedValue(
        new Map(
          entries.map(([key, value]) => [key, value as FormDataEntryValue])
        )
      ),
    text: vi.fn().mockResolvedValue(rawText),
    json: vi.fn().mockResolvedValue(body || {})
  } as unknown as NextRequest

  return request
}

describe('getRequestBody', () => {
  it('should parse JSON request when content-type is application/json', async () => {
    const mockBody = {
      client_name: 'Test App',
      redirect_uris: 'https://example.com/callback'
    }
    const mockRequest = createMockRequest(
      'https://example.com/api',
      'application/json',
      mockBody
    )
    const result = await getRequestBody(mockRequest)
    expect(result).toEqual(mockBody)
  })

  it('should return {} for an empty JSON body (paramless POST)', async () => {
    const mockRequest = createMockRequest(
      'https://example.com/api',
      'application/json'
    )
    ;(mockRequest.text as jest.Mock).mockResolvedValue('')
    const result = await getRequestBody(mockRequest)
    expect(result).toEqual({})
  })

  it.each([
    ['null', 'null'],
    ['a number', '42'],
    ['a string', '"example.com"'],
    ['a boolean', 'true']
  ])(
    'normalizes a well-formed non-object JSON body (%s) to {}',
    async (_label, rawBody) => {
      const mockRequest = createMockRequest(
        'https://example.com/api',
        'application/json'
      )
      ;(mockRequest.text as jest.Mock).mockResolvedValue(rawBody)
      const result = await getRequestBody(mockRequest)
      // A non-object body can't carry named params; callers read body.<field>,
      // so returning the raw null/primitive would throw. Normalize to {}.
      expect(result).toEqual({})
    }
  )

  it('should throw on a malformed non-empty JSON body', async () => {
    const mockRequest = createMockRequest(
      'https://example.com/api',
      'application/json'
    )
    ;(mockRequest.text as jest.Mock).mockResolvedValue('{ not json')
    await expect(getRequestBody(mockRequest)).rejects.toThrow()
  })

  it('should parse urlencoded request with URLSearchParams, not formData', async () => {
    const mockBody = {
      client_name: 'Test App',
      redirect_uris: 'https://example.com/callback'
    }
    const mockRequest = createMockRequest(
      'https://example.com/api',
      'application/x-www-form-urlencoded',
      mockBody
    )
    const result = await getRequestBody(mockRequest)
    expect(mockRequest.text).toHaveBeenCalled()
    expect(mockRequest.formData).not.toHaveBeenCalled()
    expect(result).toEqual(mockBody)
  })

  it('keeps the last value for a repeated urlencoded key (last-write-wins)', async () => {
    const mockRequest = createMockRequest(
      'https://example.com/api',
      'application/x-www-form-urlencoded'
    )
    ;(mockRequest.text as jest.Mock).mockResolvedValue('key=first&key=second')
    const result = await getRequestBody(mockRequest)
    // Object.fromEntries collapses duplicate keys to the last value; the mute
    // route's fields are single-valued, so this is the intended contract.
    expect(result).toEqual({ key: 'second' })
  })

  it('should parse multipart/form-data request with formData', async () => {
    const mockBody = {
      client_name: 'Test App',
      redirect_uris: 'https://example.com/callback'
    }
    const mockRequest = createMockRequest(
      'https://example.com/api',
      'multipart/form-data; boundary=----boundary',
      mockBody
    )
    const result = await getRequestBody(mockRequest)
    expect(mockRequest.formData).toHaveBeenCalled()
    expect(result).toEqual(mockBody)
  })

  it('should return an empty object when content-type is missing', async () => {
    const mockRequest = createMockRequest(
      'https://example.com/api',
      undefined,
      {
        client_name: 'Test App'
      }
    )
    const result = await getRequestBody(mockRequest)
    expect(mockRequest.formData).not.toHaveBeenCalled()
    expect(result).toEqual({})
  })
})
