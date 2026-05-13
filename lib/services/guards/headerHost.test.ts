import { IncomingHttpHeaders } from 'http'

import { getConfig } from '@/lib/config'

import { headerHost } from './headerHost'

const mockGetConfig = getConfig as jest.Mock

describe('#headerHost', () => {
  beforeEach(() => {
    mockGetConfig.mockReturnValue({
      host: 'test.llun.dev',
      allowActorDomains: ['actor.llun.dev'],
      trustedHosts: ['test-forwarded.llun.dev', 'test-custom.llun.dev']
    })
  })

  describe('standard headers', () => {
    it('returns host value from Headers', () => {
      const headers = new Headers([['Host', 'test.llun.dev']])
      expect(headerHost(headers)).toEqual('test.llun.dev')
    })

    it('returns config host when host header is a bind address like 0.0.0.0', () => {
      const headers = new Headers([['Host', '0.0.0.0']])
      expect(headerHost(headers)).toEqual('test.llun.dev')
    })

    it('returns config host when host is not configured as a trusted local host', () => {
      const headers = new Headers([['Host', 'evil.llun.dev']])
      expect(headerHost(headers)).toEqual('test.llun.dev')
    })

    it('returns X-Forwarded-Host when it is configured as a trusted local host', () => {
      const headers = new Headers([
        ['Host', 'test.llun.dev'],
        ['X-Forwarded-Host', 'test-forwarded.llun.dev']
      ])
      expect(headerHost(headers)).toEqual('test-forwarded.llun.dev')
    })

    it('returns trusted forwarded hosts with an explicit default HTTPS port', () => {
      const headers = new Headers([
        ['Host', 'test.llun.dev'],
        ['X-Forwarded-Host', 'test-forwarded.llun.dev:443']
      ])
      expect(headerHost(headers)).toEqual('test-forwarded.llun.dev:443')
    })

    it('rejects trusted forwarded hosts with an unconfigured non-default proxy port', () => {
      const headers = new Headers([
        ['Host', 'test.llun.dev'],
        ['X-Forwarded-Host', 'test-forwarded.llun.dev:8443']
      ])
      expect(headerHost(headers)).toEqual('test.llun.dev')
    })

    it('returns host from custom Activity.next header when it is configured as a trusted local host', () => {
      const headers = new Headers([
        ['Host', 'test.llun.dev'],
        ['X-Activity-Next-Host', 'test-custom.llun.dev']
      ])
      expect(headerHost(headers)).toEqual('test-custom.llun.dev')
    })

    it('returns config host when X-Forwarded-Host is not configured as a trusted local host', () => {
      const headers = new Headers([
        ['Host', 'internal.llun.dev'],
        ['X-Forwarded-Host', 'evil.llun.dev']
      ])
      expect(headerHost(headers)).toEqual('test.llun.dev')
    })

    it('does not trust X-Forwarded-Host from actor domain allowlists', () => {
      const headers = new Headers([
        ['Host', 'internal.llun.dev'],
        ['X-Forwarded-Host', 'actor.llun.dev']
      ])
      expect(headerHost(headers)).toEqual('test.llun.dev')
    })

    it('returns config host when X-Activity-Next-Host is not configured as a trusted local host', () => {
      const headers = new Headers([
        ['Host', 'internal.llun.dev'],
        ['X-Activity-Next-Host', 'evil.llun.dev']
      ])
      expect(headerHost(headers)).toEqual('test.llun.dev')
    })

    it('returns config host if no host is specify', () => {
      const headers = new Headers()
      expect(headerHost(headers)).toEqual('test.llun.dev')
    })
  })

  describe('node headers', () => {
    it('returns host value from Headers', () => {
      const headers = {
        Host: 'test.llun.dev'
      } as IncomingHttpHeaders
      expect(headerHost(headers)).toEqual('test.llun.dev')
    })

    it('returns config host when host header is a bind address like 0.0.0.0', () => {
      const headers = {
        Host: '0.0.0.0'
      } as IncomingHttpHeaders
      expect(headerHost(headers)).toEqual('test.llun.dev')
    })

    it('returns config host when host is not configured as a trusted local host', () => {
      const headers = {
        Host: 'evil.llun.dev'
      } as IncomingHttpHeaders
      expect(headerHost(headers)).toEqual('test.llun.dev')
    })

    it('returns X-Forwarded-Host when it is configured as a trusted local host', () => {
      const headers = {
        Host: 'test.llun.dev',
        'X-Forwarded-Host': 'test-forwarded.llun.dev'
      } as IncomingHttpHeaders
      expect(headerHost(headers)).toEqual('test-forwarded.llun.dev')
    })

    it('returns host from custom Activity.next header when it is configured as a trusted local host', () => {
      const headers = {
        Host: 'test.llun.dev',
        'X-Activity-Next-Host': 'test-custom.llun.dev'
      } as IncomingHttpHeaders
      expect(headerHost(headers)).toEqual('test-custom.llun.dev')
    })

    it('returns config host when X-Forwarded-Host is not configured as a trusted local host', () => {
      const headers = {
        Host: 'internal.llun.dev',
        'X-Forwarded-Host': 'evil.llun.dev'
      } as IncomingHttpHeaders
      expect(headerHost(headers)).toEqual('test.llun.dev')
    })

    it('returns config host when X-Activity-Next-Host is not configured as a trusted local host', () => {
      const headers = {
        Host: 'internal.llun.dev',
        'X-Activity-Next-Host': 'evil.llun.dev'
      } as IncomingHttpHeaders
      expect(headerHost(headers)).toEqual('test.llun.dev')
    })

    it('returns config host if no host is specify', () => {
      const headers = {} as IncomingHttpHeaders
      expect(headerHost(headers)).toEqual('test.llun.dev')
    })
  })
})
