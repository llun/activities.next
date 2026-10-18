import {
  SafeRemoteFetchError,
  type SafeRemoteFetchOptions
} from '@/lib/utils/safeRemoteFetch'

import {
  DOMAIN_CHECK_PATH,
  checkDomainReachability,
  getDomainCheckProof,
  getDomainCheckRequestHost,
  isDomainCheckNonce
} from './domainCheck'

const SECRET = 'server-secret'

// A fetch that answers like this server would when the request arrives with
// `seenHost` as its Host.
const answeringAs =
  (seenHost: string, secret = SECRET) =>
  async ({ url }: SafeRemoteFetchOptions) => {
    const nonce = new URL(url).searchParams.get('nonce') ?? ''
    return {
      statusCode: 200,
      body: JSON.stringify({
        proof: getDomainCheckProof(nonce, seenHost, secret)
      }),
      bodyTruncated: false,
      headers: {},
      url
    }
  }

const failingWith = (error: unknown) => async () => {
  throw error
}

describe('getDomainCheckProof', () => {
  it('depends on the nonce, the host and the secret', () => {
    const proof = getDomainCheckProof('n'.repeat(16), 'run.example', SECRET)
    expect(getDomainCheckProof('n'.repeat(16), 'run.example', SECRET)).toBe(
      proof
    )
    expect(getDomainCheckProof('m'.repeat(16), 'run.example', SECRET)).not.toBe(
      proof
    )
    expect(
      getDomainCheckProof('n'.repeat(16), 'social.example', SECRET)
    ).not.toBe(proof)
    expect(
      getDomainCheckProof('n'.repeat(16), 'run.example', 'other')
    ).not.toBe(proof)
  })
})

describe('isDomainCheckNonce', () => {
  it.each([
    ['a'.repeat(16), true],
    ['A-b_c'.repeat(10), true],
    ['short', false],
    ['a'.repeat(129), false],
    ['has space in it!!', false],
    [null, false]
  ])('%s → %s', (value, expected) => {
    expect(isDomainCheckNonce(value)).toBe(expected)
  })
})

describe('getDomainCheckRequestHost', () => {
  it('reads the host the request arrived with, normalised, without the trust filter', () => {
    expect(
      getDomainCheckRequestHost(new Headers({ host: 'Photos.Example:443' }))
    ).toBe('photos.example')
    expect(
      getDomainCheckRequestHost(
        new Headers({
          host: 'internal:3000',
          'x-forwarded-host': 'photos.example, proxy.internal'
        })
      )
    ).toBe('photos.example')
    expect(getDomainCheckRequestHost(new Headers())).toBe('')
  })
})

describe('checkDomainReachability', () => {
  it('passes when the domain answers as this server with its own Host', async () => {
    const fetch = vi.fn(answeringAs('photos.example'))
    const result = await checkDomainReachability({
      domain: 'photos.example',
      fetch,
      secret: SECRET
    })
    expect(result).toEqual({
      passed: true,
      reason: 'passed',
      items: [
        { key: 'dns', status: 'passed' },
        { key: 'tls', status: 'passed' },
        { key: 'host', status: 'passed' }
      ]
    })
    const [{ url, maxRedirects, allowCrossHostRedirects }] = fetch.mock.calls[0]
    expect(url).toMatch(
      new RegExp(`^https://photos\\.example${DOMAIN_CHECK_PATH}\\?nonce=`)
    )
    expect(maxRedirects).toBe(0)
    expect(allowCrossHostRedirects).toBe(false)
  })

  it('uses a fresh nonce on every check', async () => {
    const fetch = vi.fn(answeringAs('photos.example'))
    await checkDomainReachability({
      domain: 'photos.example',
      fetch,
      secret: SECRET
    })
    await checkDomainReachability({
      domain: 'photos.example',
      fetch,
      secret: SECRET
    })
    expect(fetch.mock.calls[0][0].url).not.toBe(fetch.mock.calls[1][0].url)
  })

  it('says the proxy dropped the Host header when the proof names an env host', async () => {
    const result = await checkDomainReachability({
      domain: 'photos.example',
      knownHosts: ['social.example'],
      fetch: answeringAs('social.example'),
      secret: SECRET
    })
    expect(result.passed).toBe(false)
    expect(result.reason).toBe('host-header')
    expect(result.items[2]).toEqual({ key: 'host', status: 'failed' })
  })

  it('says another server answered when the proof is not ours', async () => {
    const result = await checkDomainReachability({
      domain: 'photos.example',
      knownHosts: ['social.example'],
      fetch: answeringAs('photos.example', 'someone-else'),
      secret: SECRET
    })
    expect(result).toMatchObject({ passed: false, reason: 'other-server' })
  })

  it('says another server answered for a non-200 or a body without a proof', async () => {
    const result = await checkDomainReachability({
      domain: 'photos.example',
      fetch: async ({ url }: { url: string }) => ({
        statusCode: 404,
        body: '<html>not found</html>',
        bodyTruncated: false,
        headers: {},
        url
      }),
      secret: SECRET
    })
    expect(result.reason).toBe('other-server')
  })

  it.each([
    [
      'dns',
      new SafeRemoteFetchError(
        'Unable to resolve remote host',
        'ERR_UNSAFE_REMOTE_URL'
      ),
      ['failed', 'skipped', 'skipped']
    ],
    [
      'dns',
      Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }),
      ['failed', 'skipped', 'skipped']
    ],
    [
      'private-address',
      new SafeRemoteFetchError(
        'Remote host resolves to a private address',
        'ERR_UNSAFE_REMOTE_URL'
      ),
      ['failed', 'skipped', 'skipped']
    ],
    [
      'tls',
      Object.assign(new Error('unable to verify the first certificate'), {
        code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
      }),
      ['passed', 'failed', 'skipped']
    ],
    [
      'unreachable',
      Object.assign(new Error('connect ECONNREFUSED'), {
        code: 'ECONNREFUSED'
      }),
      ['passed', 'skipped', 'skipped']
    ]
  ])('classifies a %s failure', async (reason, error, statuses) => {
    const result = await checkDomainReachability({
      domain: 'photos.example',
      fetch: failingWith(error),
      secret: SECRET
    })
    expect(result.passed).toBe(false)
    expect(result.reason).toBe(reason)
    expect(result.items.map((item) => item.status)).toEqual(statuses)
  })
})
