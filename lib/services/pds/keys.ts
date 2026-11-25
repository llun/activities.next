import { Secp256k1Keypair } from '@atproto/crypto'

import {
  PDS_SIGNING_KEY_HKDF_INFO,
  decryptSecret,
  encryptSecret
} from '@/lib/utils/secretBox'

export type PdsSigningKeySecretOptions = {
  secretPhase?: string
}

/**
 * Generates a fresh exportable secp256k1 signing keypair for a PDS repo.
 * Never log the keypair or its exported bytes.
 */
export const createPdsSigningKey = (): Promise<Secp256k1Keypair> =>
  Secp256k1Keypair.create({ exportable: true })

/**
 * Exports a secp256k1 private key as base64 and encrypts it with the instance's
 * versioned AES-256-GCM envelope, binding the ciphertext to `did` via AAD.
 */
export const encryptPdsSigningKey = async (
  keypair: Secp256k1Keypair,
  did: string,
  options: PdsSigningKeySecretOptions = {}
): Promise<string> => {
  if (!did) {
    throw new Error('DID is required to encrypt a PDS signing key')
  }
  const exported = await keypair.export()
  const base64PrivateKey = Buffer.from(
    exported.buffer,
    exported.byteOffset,
    exported.byteLength
  ).toString('base64')
  return encryptSecret(base64PrivateKey, {
    info: PDS_SIGNING_KEY_HKDF_INFO,
    aad: did,
    ...options
  })
}

/**
 * Decrypts and imports the secp256k1 signing keypair stored on a `pds_repos` row,
 * verifying that the ciphertext is bound to `repoRow.did`.
 */
export const loadPdsSigningKey = async (
  repoRow: { did: string; signingKey: string },
  options: PdsSigningKeySecretOptions = {}
): Promise<Secp256k1Keypair> => {
  if (!repoRow.did) {
    throw new Error('DID is required to decrypt a PDS signing key')
  }
  const base64PrivateKey = decryptSecret(repoRow.signingKey, {
    info: PDS_SIGNING_KEY_HKDF_INFO,
    aad: repoRow.did,
    ...options
  })
  const rawPrivateKey = Buffer.from(base64PrivateKey, 'base64')
  return Secp256k1Keypair.import(rawPrivateKey)
}
