import { Secp256k1Keypair, verifySignature } from '@atproto/crypto'

import {
  SERVICE_AUTH_TTL_SECONDS,
  createServiceAuthToken
} from '@/lib/services/pds/serviceAuth'

const decode = (part: string) =>
  JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))

describe('createServiceAuthToken', () => {
  it('signs a compact ES256K JWT bound to the method, verifiable with the repo key', async () => {
    const keypair = await Secp256k1Keypair.create()
    const now = Date.UTC(2026, 10, 25, 12, 0, 0)
    const token = await createServiceAuthToken({
      keypair,
      iss: 'did:plc:alice',
      aud: 'did:web:api.bsky.app',
      lxm: 'app.bsky.feed.getTimeline',
      now
    })

    const parts = token.split('.')
    expect(parts).toHaveLength(3)
    const [header, payload, signature] = parts
    expect(decode(header)).toEqual({ typ: 'JWT', alg: 'ES256K' })
    const claims = decode(payload)
    expect(claims).toMatchObject({
      iss: 'did:plc:alice',
      aud: 'did:web:api.bsky.app',
      lxm: 'app.bsky.feed.getTimeline',
      iat: now / 1000,
      exp: now / 1000 + SERVICE_AUTH_TTL_SECONDS
    })
    expect(claims.exp - claims.iat).toBe(60)
    expect(claims.jti).toMatch(/^[0-9a-f]{32}$/)

    const signatureBytes = Buffer.from(signature, 'base64url')
    // Compact r||s, not DER.
    expect(signatureBytes).toHaveLength(64)
    expect(
      await verifySignature(
        keypair.did(),
        Buffer.from(`${header}.${payload}`, 'utf8'),
        signatureBytes
      )
    ).toBe(true)
    const other = await Secp256k1Keypair.create()
    expect(
      await verifySignature(
        other.did(),
        Buffer.from(`${header}.${payload}`, 'utf8'),
        signatureBytes
      )
    ).toBe(false)
  })

  it('gives every token its own jti and expiry from now', async () => {
    const keypair = await Secp256k1Keypair.create()
    const input = { keypair, iss: 'did:plc:a', aud: 'did:web:x', lxm: 'x.y.z' }
    const first = decode(
      (await createServiceAuthToken({ ...input, now: 1_000_000 })).split('.')[1]
    )
    const second = decode(
      (await createServiceAuthToken({ ...input, now: 1_030_500 })).split('.')[1]
    )
    expect(first.jti).not.toBe(second.jti)
    expect(first.exp).toBe(1060)
    expect(second.exp).toBe(1090)
  })
})
