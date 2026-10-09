import { IncomingHttpHeaders } from 'http'

import { getConfig } from '@/lib/config'

import { headerHost } from './headerHost'

const mockGetConfig = getConfig as unknown as jest.Mock

describe('headerHost', () => {
  beforeEach(() => {
    mockGetConfig.mockReturnValue({
      host: 'test.llun.dev',
      allowActorDomains: ['actor.llun.dev'],
      trustedHosts: ['test-forwarded.llun.dev', 'test-custom.llun.dev']
    })
  })

  // The same cases run against both header shapes the guards receive: a Fetch
  // `Headers` and Node's `IncomingHttpHeaders`.
  describe.each([
    {
      shape: 'standard headers',
      build: (pairs: [string, string][]) => new Headers(pairs)
    },
    {
      shape: 'node headers',
      build: (pairs: [string, string][]) =>
        Object.fromEntries(pairs) as IncomingHttpHeaders
    }
  ])('$shape', ({ build }) => {
    it.each([
      {
        description: 'returns host value from Host',
        headers: [['Host', 'test.llun.dev']],
        expected: 'test.llun.dev'
      },
      {
        description:
          'returns config host when host header is a bind address like 0.0.0.0',
        headers: [['Host', '0.0.0.0']],
        expected: 'test.llun.dev'
      },
      {
        description:
          'returns config host when host is not configured as a trusted local host',
        headers: [['Host', 'evil.llun.dev']],
        expected: 'test.llun.dev'
      },
      {
        description:
          'returns X-Forwarded-Host when it is configured as a trusted local host',
        headers: [
          ['Host', 'test.llun.dev'],
          ['X-Forwarded-Host', 'test-forwarded.llun.dev']
        ],
        expected: 'test-forwarded.llun.dev'
      },
      {
        description:
          'returns trusted forwarded hosts with an explicit default HTTPS port',
        headers: [
          ['Host', 'test.llun.dev'],
          ['X-Forwarded-Host', 'test-forwarded.llun.dev:443']
        ],
        expected: 'test-forwarded.llun.dev:443'
      },
      {
        description:
          'rejects trusted forwarded hosts with an unconfigured non-default proxy port',
        headers: [
          ['Host', 'test.llun.dev'],
          ['X-Forwarded-Host', 'test-forwarded.llun.dev:8443']
        ],
        expected: 'test.llun.dev'
      },
      {
        description:
          'returns host from custom Activity.next header when it is configured as a trusted local host',
        headers: [
          ['Host', 'test.llun.dev'],
          ['X-Activity-Next-Host', 'test-custom.llun.dev']
        ],
        expected: 'test-custom.llun.dev'
      },
      {
        description:
          'returns config host when X-Forwarded-Host is not configured as a trusted local host',
        headers: [
          ['Host', 'internal.llun.dev'],
          ['X-Forwarded-Host', 'evil.llun.dev']
        ],
        expected: 'test.llun.dev'
      },
      {
        description:
          'does not trust X-Forwarded-Host from actor domain allowlists',
        headers: [
          ['Host', 'internal.llun.dev'],
          ['X-Forwarded-Host', 'actor.llun.dev']
        ],
        expected: 'test.llun.dev'
      },
      {
        description:
          'returns config host when X-Activity-Next-Host is not configured as a trusted local host',
        headers: [
          ['Host', 'internal.llun.dev'],
          ['X-Activity-Next-Host', 'evil.llun.dev']
        ],
        expected: 'test.llun.dev'
      },
      {
        description: 'returns config host if no host is specify',
        headers: [],
        expected: 'test.llun.dev'
      }
    ] as {
      description: string
      headers: [string, string][]
      expected: string
    }[])('$description', ({ headers, expected }) => {
      expect(headerHost(build(headers))).toEqual(expected)
    })
  })
})
