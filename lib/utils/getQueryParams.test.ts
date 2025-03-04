import { NextRequest } from 'next/server'

import { getQueryParams } from './getQueryParams'

const createMockRequest = (url: string): NextRequest => {
  return {
    url
  } as unknown as NextRequest
}

describe('getQueryParams', () => {
  it('should extract query parameters from URL', () => {
    const mockRequest = createMockRequest(
      'https://example.com/api?param1=value1&param2=value2'
    )
    const result = getQueryParams(mockRequest)
    expect(result).toEqual({
      param1: 'value1',
      param2: 'value2'
    })
  })

  it('should return empty object when no query parameters exist', () => {
    const mockRequest = createMockRequest('https://example.com/api')
    const result = getQueryParams(mockRequest)
    expect(result).toEqual({})
  })

  it('should handle special characters in query parameters', () => {
    const mockRequest = createMockRequest(
      'https://example.com/api?special=hello%20world&encoding=utf-8'
    )
    const result = getQueryParams(mockRequest)
    expect(result).toEqual({
      special: 'hello world',
      encoding: 'utf-8'
    })
  })
})
