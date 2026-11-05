import { NextRequest } from 'next/server'

import {
  getTrustedClientIp,
  getTrustedClientRateLimitKey
} from './getTrustedClientIp'

const mockTrust = vi.fn(() => false)
vi.mock('@/lib/config/trustProxyIpHeaders', () => ({
  getTrustProxyIpHeadersConfig: () => mockTrust()
}))

const request = (headers: Record<string, string>) =>
  new NextRequest('https://llun.test/api/v1/apps', { headers })

describe('getTrustedClientIp', () => {
  beforeEach(() => {
    mockTrust.mockReset()
    mockTrust.mockReturnValue(false)
  })

  it('has no address unless the operator trusts the proxy headers', () => {
    expect(
      getTrustedClientIp(
        request({
          'cf-connecting-ip': '203.0.113.1',
          'x-real-ip': '203.0.113.2',
          'x-forwarded-for': '203.0.113.3'
        })
      )
    ).toBeUndefined()
  })

  describe('when the proxy headers are trusted', () => {
    beforeEach(() => {
      mockTrust.mockReturnValue(true)
    })

    it('prefers cf-connecting-ip, then x-real-ip, then x-forwarded-for', () => {
      expect(
        getTrustedClientIp(
          request({
            'cf-connecting-ip': ' 203.0.113.1 ',
            'x-real-ip': '203.0.113.2',
            'x-forwarded-for': '203.0.113.3'
          })
        )
      ).toBe('203.0.113.1')
      expect(
        getTrustedClientIp(
          request({
            'x-real-ip': '203.0.113.2',
            'x-forwarded-for': '203.0.113.3'
          })
        )
      ).toBe('203.0.113.2')
      expect(
        getTrustedClientIp(request({ 'x-forwarded-for': '203.0.113.3' }))
      ).toBe('203.0.113.3')
    })

    it('takes the first address of a forwarded chain, skipping blanks', () => {
      expect(
        getTrustedClientIp(
          request({ 'x-forwarded-for': ' , 203.0.113.4 , 10.0.0.1' })
        )
      ).toBe('203.0.113.4')
    })

    it('has no address when no header names one', () => {
      expect(getTrustedClientIp(request({}))).toBeUndefined()
      expect(
        getTrustedClientIp(request({ 'x-forwarded-for': ' , ' }))
      ).toBeUndefined()
    })

    it('normalizes IPv6 rate-limit keys to /64, maps ::ffff: IPv4, and ignores invalid IPs', () => {
      expect(
        getTrustedClientRateLimitKey(
          request({ 'x-forwarded-for': '2001:db8:abcd:12::1' })
        )
      ).toBe(
        getTrustedClientRateLimitKey(
          request({
            'x-forwarded-for': '2001:DB8:ABCD:0012:ffff:1234:5678:9abc'
          })
        )
      )
      expect(
        getTrustedClientRateLimitKey(
          request({ 'x-forwarded-for': '2001:db8:abcd:12::1' })
        )
      ).toBe('2001:0db8:abcd:0012:0000:0000:0000:0000')
      expect(
        getTrustedClientRateLimitKey(
          request({ 'x-forwarded-for': '::ffff:198.51.100.7' })
        )
      ).toBe('198.51.100.7')
      expect(
        getTrustedClientRateLimitKey(
          request({ 'x-forwarded-for': 'not-an-ip' })
        )
      ).toBeUndefined()
    })
  })
})
