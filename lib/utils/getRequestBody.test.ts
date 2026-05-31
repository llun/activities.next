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
  const request = {
    url,
    headers,
    formData: jest
      .fn()
      .mockResolvedValue(
        new Map(
          entries.map(([key, value]) => [key, value as FormDataEntryValue])
        )
      ),
    text: jest
      .fn()
      .mockResolvedValue(
        new URLSearchParams(
          entries.map(([key, value]) => [key, String(value)])
        ).toString()
      ),
    json: jest.fn().mockResolvedValue(body || {})
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
    expect(mockRequest.json).toHaveBeenCalled()
    expect(result).toEqual(mockBody)
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

  it('should parse multipart/form-data request with formData', async () => {
    const mockBody = {
      client_name: 'Test App',
      redirect_uris: 'https://example.com/callback'
    }
    const mockRequest = createMockRequest(
      'https://example.com/api',
      'multipart/form-data; boundary=abc',
      mockBody
    )
    const result = await getRequestBody(mockRequest)
    expect(mockRequest.formData).toHaveBeenCalled()
    expect(result).toEqual(mockBody)
  })

  it('should parse form data request when content-type is missing', async () => {
    const mockBody = {
      client_name: 'Test App',
      redirect_uris: 'https://example.com/callback'
    }
    const mockRequest = createMockRequest(
      'https://example.com/api',
      undefined,
      mockBody
    )
    const result = await getRequestBody(mockRequest)
    expect(mockRequest.formData).toHaveBeenCalled()
    expect(result).toEqual(mockBody)
  })
})
