import { HttpMethod, getCORSHeaders } from './getCORSHeaders'

describe('#getCORSHeaders', () => {
  it('returns CORS headers with origin from request', () => {
    const headers = new Headers([
      ['Host', 'example.com'],
      ['Origin', 'https://client.example.com']
    ])
    const result = getCORSHeaders(['GET', 'POST'], headers)

    expect(result).toEqual({
      'Access-Control-Allow-Headers':
        'authorization,content-type,idempotency-key',
      'Access-Control-Allow-Methods': 'GET,POST',
      'Access-Control-Expose-Headers': 'Link',
      'Access-Control-Allow-Origin': 'https://client.example.com'
    })
  })

  it('uses host-based origin when Origin header is not present', () => {
    const headers = new Headers([['Host', 'api.example.com']])
    const result = getCORSHeaders(['GET'], headers)

    expect(result['Access-Control-Allow-Origin']).toEqual(
      'https://api.example.com'
    )
  })

  it('joins multiple methods with comma', () => {
    const headers = new Headers([['Origin', 'https://example.com']])
    const methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE']
    const result = getCORSHeaders(methods, headers)

    expect(result['Access-Control-Allow-Methods']).toEqual(
      'GET,POST,PUT,DELETE'
    )
  })

  it('handles OPTIONS method', () => {
    const headers = new Headers([['Origin', 'https://example.com']])
    const result = getCORSHeaders(['OPTIONS', 'GET', 'POST'], headers)

    expect(result['Access-Control-Allow-Methods']).toEqual('OPTIONS,GET,POST')
  })

  it('handles empty methods array', () => {
    const headers = new Headers([['Origin', 'https://example.com']])
    const result = getCORSHeaders([], headers)

    expect(result['Access-Control-Allow-Methods']).toEqual('')
  })
})
