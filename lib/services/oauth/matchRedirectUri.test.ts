import { matchesRegisteredRedirectUri } from './matchRedirectUri'

describe('matchesRegisteredRedirectUri', () => {
  it.each([
    {
      description: 'an exact match',
      registered: ['https://app.example/callback'],
      requested: 'https://app.example/callback',
      expected: true
    },
    {
      description: 'a match against any of several registered URIs',
      registered: ['https://other.example/cb', 'https://app.example/callback'],
      requested: 'https://app.example/callback',
      expected: true
    },
    {
      description: 'a loopback URI on a different (ephemeral) port',
      registered: ['http://127.0.0.1:8080/callback'],
      requested: 'http://127.0.0.1:51234/callback',
      expected: true
    },
    {
      description: 'a loopback URI with no registered port',
      registered: ['http://127.0.0.1/callback'],
      requested: 'http://127.0.0.1:9999/callback',
      expected: true
    },
    {
      description: 'an IPv6 loopback URI on a different port',
      registered: ['http://[::1]:8080/callback'],
      requested: 'http://[::1]:51234/callback',
      expected: true
    },
    {
      description: 'a loopback URI whose path differs',
      registered: ['http://127.0.0.1:8080/callback'],
      requested: 'http://127.0.0.1:8080/evil',
      expected: false
    },
    {
      description: 'a loopback URI whose scheme differs',
      registered: ['http://127.0.0.1:8080/callback'],
      requested: 'https://127.0.0.1:8080/callback',
      expected: false
    },
    {
      description: 'a loopback URI whose query differs',
      registered: ['http://127.0.0.1:8080/callback?a=1'],
      requested: 'http://127.0.0.1:8080/callback?a=2',
      expected: false
    },
    {
      description:
        'a non-loopback host on a different port (port is NOT ignored)',
      registered: ['https://app.example:8080/callback'],
      requested: 'https://app.example:9090/callback',
      expected: false
    },
    {
      description:
        'the name localhost on a different port (not a loopback IP, exact only)',
      registered: ['http://localhost:8080/callback'],
      requested: 'http://localhost:51234/callback',
      expected: false
    },
    {
      description: 'a wholly different origin',
      registered: ['https://app.example/callback'],
      requested: 'https://attacker.example/callback',
      expected: false
    },
    {
      description: 'an empty requested URI',
      registered: ['https://app.example/callback'],
      requested: '',
      expected: false
    },
    {
      description: 'an unparseable requested URI',
      registered: ['https://app.example/callback'],
      requested: 'not a url',
      expected: false
    },
    {
      description: 'a custom scheme registered by a native app (exact match)',
      registered: ['myapp://callback'],
      requested: 'myapp://callback',
      expected: true
    },
    {
      description: 'no registered URIs at all',
      registered: [],
      requested: 'https://app.example/callback',
      expected: false
    }
  ])(
    'returns $expected for $description',
    ({ registered, requested, expected }) => {
      expect(matchesRegisteredRedirectUri(registered, requested)).toBe(expected)
    }
  )
})
