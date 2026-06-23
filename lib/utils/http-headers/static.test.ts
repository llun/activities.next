import { getStaticSecurityHeaders } from './static'

const frameOptions = (headers: { key: string; value: string }[]) =>
  headers.find((header) => header.key === 'X-Frame-Options')

describe('getStaticSecurityHeaders', () => {
  it('denies framing by default', () => {
    expect(frameOptions(getStaticSecurityHeaders())?.value).toBe('DENY')
  })

  it('omits X-Frame-Options when framing is allowed', () => {
    expect(
      frameOptions(getStaticSecurityHeaders({ allowFraming: true }))
    ).toBeUndefined()
  })

  it('always sets the other static headers', () => {
    const keys = getStaticSecurityHeaders({ allowFraming: true }).map(
      (header) => header.key
    )
    expect(keys).toEqual(
      expect.arrayContaining([
        'X-Content-Type-Options',
        'Referrer-Policy',
        'Permissions-Policy'
      ])
    )
  })
})
