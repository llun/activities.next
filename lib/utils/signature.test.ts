import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { TEST_DOMAIN } from '@/lib/stub/const'

import { parse, verify } from './signature'

describe('signature', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })

  const signString = (
    stringToSign: string,
    algorithm: 'rsa-sha256' | 'RSA-MD5' = 'rsa-sha256'
  ) => {
    const signer = crypto.createSign(algorithm)
    signer.update(stringToSign)
    signer.end()
    return signer.sign(privateKey, 'base64')
  }

  describe('parse', () => {
    it('parses standard quoted parameters', async () => {
      const header =
        'keyId="https://remote.test/actor#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="sig123"'
      const result = await parse(header)
      expect(result).toEqual({
        keyId: 'https://remote.test/actor#main-key',
        algorithm: 'rsa-sha256',
        headers: '(request-target) host date digest',
        signature: 'sig123'
      })
    })

    it('parses unquoted integer parameters for created and expires', async () => {
      const header =
        'keyId="https://remote.test/actor#main-key",algorithm="hs2019",headers="(request-target) host (created) digest",signature="sig123",created=1618884475,expires=1618888075'
      const result = await parse(header)
      expect(result).toEqual({
        keyId: 'https://remote.test/actor#main-key',
        algorithm: 'hs2019',
        headers: '(request-target) host (created) digest',
        signature: 'sig123',
        created: '1618884475',
        expires: '1618888075'
      })
    })

    it('parses quoted created/expires parameters as well', async () => {
      const header =
        'keyId="https://remote.test/actor#main-key",algorithm="hs2019",created="1618884475",expires="1618888075",signature="sig123"'
      const result = await parse(header)
      expect(result.created).toBe('1618884475')
      expect(result.expires).toBe('1618888075')
    })
  })

  describe('verify', () => {
    const requestTarget = 'post /api/inbox'
    const date = 'Sat, 29 Aug 2026 12:00:00 GMT'
    const host = TEST_DOMAIN
    const digest = 'SHA-256=47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='

    it('verifies a request signed rsa-sha256 style', async () => {
      const stringToSign = `(request-target): ${requestTarget}\nhost: ${host}\ndate: ${date}\ndigest: ${digest}`
      const signature = signString(stringToSign, 'rsa-sha256')

      const headers = new Headers({
        date,
        digest,
        host,
        signature: `keyId="https://remote.test/actor#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="${signature}"`
      })

      const isValid = await verify(requestTarget, headers, publicKey)
      expect(isValid).toBe(true)
    })

    it('verifies a request signed hs2019 style with unquoted (created) pseudo-header', async () => {
      const created = '1618884475'
      const stringToSign = `(request-target): ${requestTarget}\nhost: ${host}\n(created): ${created}\ndigest: ${digest}`
      const signature = signString(stringToSign, 'rsa-sha256')

      const headers = new Headers({
        date,
        digest,
        host,
        signature: `keyId="https://remote.test/actor#main-key",algorithm="hs2019",headers="(request-target) host (created) digest",signature="${signature}",created=${created}`
      })

      const isValid = await verify(requestTarget, headers, publicKey)
      expect(isValid).toBe(true)
    })

    it('defaults missing algorithm to hs2019 and verifies correctly', async () => {
      const created = '1618884475'
      const stringToSign = `(request-target): ${requestTarget}\nhost: ${host}\n(created): ${created}\ndigest: ${digest}`
      const signature = signString(stringToSign, 'rsa-sha256')

      const headers = new Headers({
        date,
        digest,
        host,
        signature: `keyId="https://remote.test/actor#main-key",headers="(request-target) host (created) digest",signature="${signature}",created=${created}`
      })

      const isValid = await verify(requestTarget, headers, publicKey)
      expect(isValid).toBe(true)
    })

    it('fails verification when algorithm is not in allowlist (algorithm downgrade defense)', async () => {
      const stringToSign = `(request-target): ${requestTarget}\nhost: ${host}\ndate: ${date}\ndigest: ${digest}`
      const md5Signature = signString(stringToSign, 'RSA-MD5')

      const headers = new Headers({
        date,
        digest,
        host,
        signature: `keyId="https://remote.test/actor#main-key",algorithm="rsa-md5",headers="(request-target) host date digest",signature="${md5Signature}"`
      })

      const isValid = await verify(requestTarget, headers, publicKey)
      expect(isValid).toBe(false)
    })

    it('fails verification if (created) pseudo-header is present with rsa-sha256', async () => {
      const created = '1618884475'
      const stringToSign = `(request-target): ${requestTarget}\nhost: ${host}\n(created): ${created}\ndigest: ${digest}`
      const signature = signString(stringToSign, 'rsa-sha256')

      const headers = new Headers({
        date,
        digest,
        host,
        signature: `keyId="https://remote.test/actor#main-key",algorithm="rsa-sha256",headers="(request-target) host (created) digest",signature="${signature}",created=${created}`
      })

      const isValid = await verify(requestTarget, headers, publicKey)
      expect(isValid).toBe(false)
    })

    it('fails verification if (expires) pseudo-header is present with rsa-sha256', async () => {
      const expires = '1618888075'
      const stringToSign = `(request-target): ${requestTarget}\nhost: ${host}\n(expires): ${expires}\ndigest: ${digest}`
      const signature = signString(stringToSign, 'rsa-sha256')

      const headers = new Headers({
        date,
        digest,
        host,
        signature: `keyId="https://remote.test/actor#main-key",algorithm="rsa-sha256",headers="(request-target) host (expires) digest",signature="${signature}",expires=${expires}`
      })

      const isValid = await verify(requestTarget, headers, publicKey)
      expect(isValid).toBe(false)
    })

    it('fails verification if body/digest is tampered', async () => {
      const stringToSign = `(request-target): ${requestTarget}\nhost: ${host}\ndate: ${date}\ndigest: ${digest}`
      const signature = signString(stringToSign, 'rsa-sha256')

      const headers = new Headers({
        date,
        digest: 'SHA-256=tampereddigesttampereddigesttampereddigest===',
        host,
        signature: `keyId="https://remote.test/actor#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="${signature}"`
      })

      const isValid = await verify(requestTarget, headers, publicKey)
      expect(isValid).toBe(false)
    })

    it('fails verification if date is tampered', async () => {
      const stringToSign = `(request-target): ${requestTarget}\nhost: ${host}\ndate: ${date}\ndigest: ${digest}`
      const signature = signString(stringToSign, 'rsa-sha256')

      const headers = new Headers({
        date: 'Sun, 30 Aug 2026 12:00:00 GMT',
        digest,
        host,
        signature: `keyId="https://remote.test/actor#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="${signature}"`
      })

      const isValid = await verify(requestTarget, headers, publicKey)
      expect(isValid).toBe(false)
    })
  })
})
