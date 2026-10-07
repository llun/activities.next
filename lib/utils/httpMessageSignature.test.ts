import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'

import {
  MAX_COVERED_COMPONENTS,
  MAX_SIGNATURE_INPUT_LENGTH,
  buildSignatureBase,
  hasRequiredHttpMessageSignatureComponents,
  parseHttpMessageSignature,
  verifyHttpMessageSignature
} from './httpMessageSignature'

const ED_PUBLIC =
  '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAJrQLj5P/89iXES9+vFgrIy29clF9CC/oPPsw3c5D0bs=\n-----END PUBLIC KEY-----\n'
const ED_PRIVATE =
  '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIJ+DYvh6SEqVTm50DFtMDoQikTmiCqirVv9mWG9qfSnF\n-----END PRIVATE KEY-----\n'
const ED_INPUT =
  'sig-b26=("date" "@method" "@path" "@authority" "content-type" "content-length");created=1618884473;keyid="test-key-ed25519"'
const ED_SIGNATURE =
  'sig-b26=:ITPJ3ysYzbJCg2mzpPJLEnnw2DaEgzcVhJnhtGXIxAVkYy16n+CZKDwJ2maXIk8UUokuolHKleZFxNtH5wXwDA==:'
const ED_BASE = [
  '"date": Tue, 20 Apr 2021 02:07:56 GMT',
  '"@method": POST',
  '"@path": /foo',
  '"@authority": example.com',
  '"content-type": application/json',
  '"content-length": 18',
  '"@signature-params": ("date" "@method" "@path" "@authority" "content-type" "content-length");created=1618884473;keyid="test-key-ed25519"'
].join('\n')

const edHeaders = (overrides: Record<string, string> = {}) =>
  new Headers({
    date: 'Tue, 20 Apr 2021 02:07:56 GMT',
    'content-type': 'application/json',
    'content-length': '18',
    'signature-input': ED_INPUT,
    signature: ED_SIGNATURE,
    ...overrides
  })

const edRequest = (targetUri = 'https://example.com/foo') => ({
  method: 'POST',
  targetUri,
  headers: edHeaders()
})

const rsa = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
})

const TARGET = 'https://activities.local/api/inbox'

const signRsa = (
  params: string,
  targetUri = TARGET,
  extraHeaders: Record<string, string> = {}
) => {
  const base = [
    '"@method": POST',
    `"@target-uri": ${targetUri}`,
    '"content-digest": sha-256=:X48E9qOokqqrvdts8nOJRJN3OWDUoyWxBf7kbu9DBPE=:',
    `"@signature-params": ${params}`
  ].join('\n')
  const sig = crypto
    .sign('sha256', Buffer.from(base), rsa.privateKey)
    .toString('base64')
  return new Headers({
    'content-digest': 'sha-256=:X48E9qOokqqrvdts8nOJRJN3OWDUoyWxBf7kbu9DBPE=:',
    'signature-input': `sig1=${params}`,
    signature: `sig1=:${sig}:`,
    ...extraHeaders
  })
}

const RSA_PARAMS =
  '("@method" "@target-uri" "content-digest");created=1618884473;keyid="https://remote.test/users/alice#main-key";alg="rsa-v1_5-sha256"'

describe('parseHttpMessageSignature', () => {
  it('parses the RFC 9421 style vector', () => {
    const parsed = parseHttpMessageSignature(edHeaders())
    expect(parsed).toMatchObject({
      label: 'sig-b26',
      components: [
        'date',
        '@method',
        '@path',
        '@authority',
        'content-type',
        'content-length'
      ],
      keyId: 'test-key-ed25519',
      algorithm: null,
      createdSec: 1618884473,
      expiresSec: null
    })
    expect(parsed?.signature).toHaveLength(64)
    expect(parsed?.signatureParams).toBe(ED_INPUT.slice('sig-b26='.length))
  })

  it('parses alg and expires', () => {
    const parsed = parseHttpMessageSignature(
      signRsa(`${RSA_PARAMS};expires=1618884773`)
    )
    expect(parsed?.algorithm).toBe('rsa-v1_5-sha256')
    expect(parsed?.expiresSec).toBe(1618884773)
  })

  it('returns null when either header is missing', () => {
    const headers = edHeaders()
    headers.delete('signature')
    expect(parseHttpMessageSignature(headers)).toBeNull()
    const noInput = edHeaders()
    noInput.delete('signature-input')
    expect(parseHttpMessageSignature(noInput)).toBeNull()
  })

  it('returns null when the Signature header exceeds the length cap', () => {
    const padding = 'a'.repeat(MAX_SIGNATURE_INPUT_LENGTH)
    expect(
      parseHttpMessageSignature(
        edHeaders({ signature: `${ED_SIGNATURE}, x=:${padding}:` })
      )
    ).toBeNull()
  })

  it('returns null when the label is absent from Signature', () => {
    expect(
      parseHttpMessageSignature(
        edHeaders({ signature: ED_SIGNATURE.replace('sig-b26', 'other') })
      )
    ).toBeNull()
  })

  it('picks the first label present in both headers', () => {
    const headers = edHeaders({
      'signature-input': `extra=("@method");keyid="x", ${ED_INPUT}`
    })
    expect(parseHttpMessageSignature(headers)?.label).toBe('sig-b26')
  })

  it.each([
    ['component parameters', 'sig1=("content-digest";sf);keyid="k"'],
    ['the req parameter', 'sig1=("@method";req);keyid="k"'],
    ['duplicate components', 'sig1=("@method" "@method");keyid="k"'],
    ['@query-param', 'sig1=("@query-param";name="a");keyid="k"'],
    ['@status', 'sig1=("@status");keyid="k"'],
    ['@signature-params', 'sig1=("@signature-params");keyid="k"'],
    ['uppercase header names', 'sig1=("Content-Digest");keyid="k"'],
    ['a missing keyid', 'sig1=("@method")'],
    ['a non-string keyid', 'sig1=("@method");keyid=1'],
    ['a non-integer created', 'sig1=("@method");keyid="k";created="1"'],
    ['a decimal expires', 'sig1=("@method");keyid="k";expires=1.5'],
    ['a non-string alg', 'sig1=("@method");keyid="k";alg=ed25519'],
    ['a non-list member', 'sig1="@method"'],
    ['malformed dictionaries', 'sig1=("@method"']
  ])('returns null for %s', (_name, input) => {
    expect(
      parseHttpMessageSignature(
        new Headers({ 'signature-input': input, signature: 'sig1=:AAAA:' })
      )
    ).toBeNull()
  })

  it('returns null for a non-bytes signature', () => {
    expect(
      parseHttpMessageSignature(
        new Headers({
          'signature-input': 'sig1=("@method");keyid="k"',
          signature: 'sig1="AAAA"'
        })
      )
    ).toBeNull()
  })

  it('enforces component and length limits', () => {
    const many = Array.from(
      { length: MAX_COVERED_COMPONENTS + 1 },
      (_, i) => `"x-h${i}"`
    ).join(' ')
    expect(
      parseHttpMessageSignature(
        new Headers({
          'signature-input': `sig1=(${many});keyid="k"`,
          signature: 'sig1=:AAAA:'
        })
      )
    ).toBeNull()
    expect(
      parseHttpMessageSignature(
        new Headers({
          'signature-input': `sig1=("@method");keyid="${'a'.repeat(MAX_SIGNATURE_INPUT_LENGTH)}"`,
          signature: 'sig1=:AAAA:'
        })
      )
    ).toBeNull()
  })
})

describe('hasRequiredHttpMessageSignatureComponents', () => {
  const has = (components: string[], method = 'POST', target = TARGET) =>
    hasRequiredHttpMessageSignatureComponents(components, method, target)

  it('accepts POST with target-uri and digest', () => {
    expect(has(['@method', '@target-uri', 'content-digest'])).toBe(true)
  })

  it('accepts POST with authority, path and digest', () => {
    expect(has(['@method', '@authority', '@path', 'content-digest'])).toBe(true)
  })

  it('rejects POST without a digest', () => {
    expect(has(['@method', '@target-uri'])).toBe(false)
  })

  it('rejects without @method', () => {
    expect(has(['@target-uri', 'content-digest'])).toBe(false)
  })

  it('rejects when only the authority or only the path is covered', () => {
    expect(has(['@method', '@authority', 'content-digest'])).toBe(false)
    expect(has(['@method', '@path', 'content-digest'])).toBe(false)
  })

  it('requires the query to be covered when the URL has one', () => {
    const target = 'https://h.test/x?y=1'
    expect(has(['@method', '@authority', '@path'], 'GET', target)).toBe(false)
    expect(
      has(['@method', '@authority', '@path', '@query'], 'GET', target)
    ).toBe(true)
    expect(
      has(['@method', '@authority', '@request-target'], 'GET', target)
    ).toBe(false)
    expect(has(['@method', '@target-uri'], 'GET', target)).toBe(true)
  })

  it('requires GET to cover the destination', () => {
    expect(has(['@method', '@path', '@scheme'], 'GET')).toBe(false)
  })

  it('rejects an unparseable target', () => {
    expect(has(['@method', '@target-uri'], 'GET', 'not a url')).toBe(false)
  })
})

describe('buildSignatureBase', () => {
  it('matches the expected base for the ed25519 vector', () => {
    const parsed = parseHttpMessageSignature(edHeaders())!
    expect(buildSignatureBase(parsed, edRequest())).toBe(ED_BASE)
  })

  it('derives every component from the trusted target uri', () => {
    const headers = new Headers({
      'signature-input':
        'sig1=("@method" "@target-uri" "@authority" "@scheme" "@path" "@query" "@request-target" "x-a");keyid="k"',
      signature: 'sig1=:AAAA:',
      'x-a': '  padded  '
    })
    const parsed = parseHttpMessageSignature(headers)!
    expect(
      buildSignatureBase(parsed, {
        method: 'POST',
        targetUri: 'https://Example.COM:443/a/b?q=1',
        headers
      })?.split('\n')
    ).toEqual([
      '"@method": POST',
      '"@target-uri": https://Example.COM:443/a/b?q=1',
      '"@authority": example.com',
      '"@scheme": https',
      '"@path": /a/b',
      '"@query": ?q=1',
      '"@request-target": /a/b?q=1',
      '"x-a": padded',
      '"@signature-params": ("@method" "@target-uri" "@authority" "@scheme" "@path" "@query" "@request-target" "x-a");keyid="k"'
    ])
  })

  it('uses "?" for an empty query and keeps non-default ports', () => {
    const headers = new Headers({
      'signature-input': 'sig1=("@query" "@authority");keyid="k"',
      signature: 'sig1=:AAAA:'
    })
    const parsed = parseHttpMessageSignature(headers)!
    expect(
      buildSignatureBase(parsed, {
        method: 'GET',
        targetUri: 'https://h.test:8443/',
        headers
      })
    ).toContain('"@query": ?\n"@authority": h.test:8443')
  })

  it('returns null when a covered header is missing', () => {
    const parsed = parseHttpMessageSignature(edHeaders())!
    const headers = edHeaders()
    headers.delete('content-type')
    expect(buildSignatureBase(parsed, { ...edRequest(), headers })).toBeNull()
  })
})

describe('verifyHttpMessageSignature', () => {
  it('self-checks the ed25519 vector by signing the base', () => {
    const computed = crypto
      .sign(null, Buffer.from(ED_BASE), ED_PRIVATE)
      .toString('base64')
    expect(`sig-b26=:${computed}:`).toBe(ED_SIGNATURE)
  })

  it('verifies the ed25519 vector without an alg parameter', async () => {
    const parsed = parseHttpMessageSignature(edHeaders())!
    expect(
      await verifyHttpMessageSignature(parsed, edRequest(), ED_PUBLIC)
    ).toBe(true)
  })

  it('rejects an altered path', async () => {
    const parsed = parseHttpMessageSignature(edHeaders())!
    expect(
      await verifyHttpMessageSignature(
        parsed,
        edRequest('https://example.com/bar'),
        ED_PUBLIC
      )
    ).toBe(false)
  })

  it('rejects a request signed for another host', async () => {
    const parsed = parseHttpMessageSignature(edHeaders())!
    expect(
      await verifyHttpMessageSignature(
        parsed,
        edRequest('https://evil.test/foo'),
        ED_PUBLIC
      )
    ).toBe(false)
  })

  it('rejects a changed covered header', async () => {
    const parsed = parseHttpMessageSignature(edHeaders())!
    expect(
      await verifyHttpMessageSignature(
        parsed,
        {
          ...edRequest(),
          headers: edHeaders({ 'content-length': '19' })
        },
        ED_PUBLIC
      )
    ).toBe(false)
  })

  it('rejects a missing covered header', async () => {
    const parsed = parseHttpMessageSignature(edHeaders())!
    const headers = edHeaders()
    headers.delete('date')
    expect(
      await verifyHttpMessageSignature(
        parsed,
        { ...edRequest(), headers },
        ED_PUBLIC
      )
    ).toBe(false)
  })

  it('verifies rsa-v1_5-sha256', async () => {
    const headers = signRsa(RSA_PARAMS)
    const parsed = parseHttpMessageSignature(headers)!
    expect(
      await verifyHttpMessageSignature(
        parsed,
        { method: 'POST', targetUri: TARGET, headers },
        rsa.publicKey
      )
    ).toBe(true)
  })

  it('infers rsa when alg is absent', async () => {
    const headers = signRsa(
      '("@method" "@target-uri" "content-digest");created=1618884473;keyid="k"'
    )
    const parsed = parseHttpMessageSignature(headers)!
    expect(parsed.algorithm).toBeNull()
    expect(
      await verifyHttpMessageSignature(
        parsed,
        { method: 'POST', targetUri: TARGET, headers },
        rsa.publicKey
      )
    ).toBe(true)
  })

  it('rejects the rsa signature for a different target uri', async () => {
    const headers = signRsa(RSA_PARAMS)
    const parsed = parseHttpMessageSignature(headers)!
    expect(
      await verifyHttpMessageSignature(
        parsed,
        {
          method: 'POST',
          targetUri: 'https://evil.test/api/inbox',
          headers
        },
        rsa.publicKey
      )
    ).toBe(false)
  })

  it('rejects alg ed25519 with an rsa key', async () => {
    const headers = signRsa(RSA_PARAMS.replace('rsa-v1_5-sha256', 'ed25519'))
    const parsed = parseHttpMessageSignature(headers)!
    expect(
      await verifyHttpMessageSignature(
        parsed,
        { method: 'POST', targetUri: TARGET, headers },
        rsa.publicKey
      )
    ).toBe(false)
  })

  it('rejects alg rsa-v1_5-sha256 with an ed25519 key', async () => {
    const parsed = parseHttpMessageSignature(edHeaders())!
    expect(
      await verifyHttpMessageSignature(
        { ...parsed, algorithm: 'rsa-v1_5-sha256' },
        edRequest(),
        ED_PUBLIC
      )
    ).toBe(false)
  })

  it('rejects unsupported algorithms', async () => {
    const headers = signRsa(
      RSA_PARAMS.replace('rsa-v1_5-sha256', 'rsa-pss-sha512')
    )
    const parsed = parseHttpMessageSignature(headers)!
    expect(
      await verifyHttpMessageSignature(
        parsed,
        { method: 'POST', targetUri: TARGET, headers },
        rsa.publicKey
      )
    ).toBe(false)
  })

  it('returns false for an invalid public key', async () => {
    const parsed = parseHttpMessageSignature(edHeaders())!
    expect(
      await verifyHttpMessageSignature(parsed, edRequest(), 'not a pem')
    ).toBe(false)
  })
})
