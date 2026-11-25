import type { Keypair } from '@atproto/crypto'
import crypto from 'node:crypto'

// atproto inter-service auth (https://atproto.com/specs/xrpc#inter-service-authentication-jwt):
// a short-lived compact JWS the account's repo signing key signs, bound to one
// XRPC method by `lxm`. @atproto/xrpc-server is not installed; this is the
// small part of its `createServiceJwt` hosted accounts need.

export const SERVICE_AUTH_TTL_SECONDS = 60

const toBase64UrlJson = (value: unknown) =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')

/**
 * A service-auth token from `iss` (the account's DID) to `aud` (the service
 * DID, without a `#service` fragment) for the `lxm` method, valid for 60
 * seconds. ES256K: the repo signing key is secp256k1, and `keypair.sign`
 * hashes with SHA-256 and returns the compact low-S signature JWS expects.
 * The token is a bearer credential: never log it.
 */
export const createServiceAuthToken = async ({
  keypair,
  iss,
  aud,
  lxm,
  now = Date.now()
}: {
  keypair: Pick<Keypair, 'sign'>
  iss: string
  aud: string
  lxm: string
  now?: number
}): Promise<string> => {
  const iat = Math.floor(now / 1000)
  const header = { typ: 'JWT', alg: 'ES256K' }
  const payload = {
    iss,
    aud,
    lxm,
    exp: iat + SERVICE_AUTH_TTL_SECONDS,
    iat,
    jti: crypto.randomBytes(16).toString('hex')
  }
  const signingInput = `${toBase64UrlJson(header)}.${toBase64UrlJson(payload)}`
  const signature = await keypair.sign(Buffer.from(signingInput, 'utf8'))
  return `${signingInput}.${Buffer.from(signature).toString('base64url')}`
}
