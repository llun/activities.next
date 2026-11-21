import {
  STRICT_TRANSPORT_SECURITY_HEADER,
  getStrictTransportSecurityHeader
} from './hsts'

const request = (protocol: string, hostname: string) => ({
  nextUrl: { protocol, hostname }
})

describe('getStrictTransportSecurityHeader', () => {
  it('returns the one-year header for an HTTPS request', () => {
    expect(
      getStrictTransportSecurityHeader(request('https:', 'llun.social'))
    ).toEqual({
      key: 'Strict-Transport-Security',
      value: 'max-age=31536000'
    })
  })

  it('does not add includeSubDomains or preload', () => {
    expect(STRICT_TRANSPORT_SECURITY_HEADER.value).toBe('max-age=31536000')
  })

  it('returns null for a plain-HTTP request', () => {
    expect(
      getStrictTransportSecurityHeader(request('http:', 'llun.social'))
    ).toBeNull()
  })

  it.each(['localhost', '127.0.0.1', '[::1]'])(
    'returns null for the local host %s even over HTTPS',
    (hostname) => {
      expect(
        getStrictTransportSecurityHeader(request('https:', hostname))
      ).toBeNull()
    }
  )
})
