import crypto from 'node:crypto'

import {
  PDS_BLOB_STORAGE_KEY_HKDF_INFO,
  PDS_SIGNING_KEY_HKDF_INFO,
  decryptSecret,
  decryptSecretBytes,
  deriveSecretKey,
  encryptSecret
} from '@/lib/utils/secretBox'

const TEST_INFO = PDS_SIGNING_KEY_HKDF_INFO

const flipFirstByteBase64Url = (encoded: string): string => {
  const buf = Buffer.from(encoded, 'base64url')
  buf[0] ^= 0xff
  return buf.toString('base64url')
}

describe('secretBox', () => {
  it('round-trips UTF-8 strings and raw bytes using v1 AES-256-GCM envelope', () => {
    const plaintext = 'secp256k1-private-key-material-0123456789abcdef'
    const sealed = encryptSecret(plaintext, { info: TEST_INFO })

    const parts = sealed.split(':')
    expect(parts).toHaveLength(4)
    expect(parts[0]).toBe('v1')
    expect(Buffer.from(parts[1], 'base64url')).toHaveLength(12)
    expect(Buffer.from(parts[2], 'base64url')).toHaveLength(16)
    expect(sealed).not.toContain(plaintext)

    expect(decryptSecret(sealed, { info: TEST_INFO })).toBe(plaintext)

    const rawBytes = crypto.randomBytes(32)
    const sealedBytes = encryptSecret(rawBytes, { info: TEST_INFO })
    expect(decryptSecretBytes(sealedBytes, { info: TEST_INFO })).toEqual(
      rawBytes
    )
  })

  it('produces distinct ciphertexts for the same plaintext via random 12-byte IVs', () => {
    const first = encryptSecret('identical-secret', { info: TEST_INFO })
    const second = encryptSecret('identical-secret', { info: TEST_INFO })

    expect(first).not.toBe(second)
    expect(first.split(':')[1]).not.toBe(second.split(':')[1])
    expect(decryptSecret(first, { info: TEST_INFO })).toBe('identical-secret')
    expect(decryptSecret(second, { info: TEST_INFO })).toBe('identical-secret')
  })

  it('supports empty plaintext round-trip', () => {
    const sealed = encryptSecret('', { info: TEST_INFO })
    expect(decryptSecret(sealed, { info: TEST_INFO })).toBe('')
    expect(decryptSecretBytes(sealed, { info: TEST_INFO })).toEqual(
      Buffer.alloc(0)
    )
  })

  it('rejects tampering with IV, auth tag, or ciphertext', () => {
    const sealed = encryptSecret('sensitive-signing-key', { info: TEST_INFO })
    const [version, iv, tag, ct] = sealed.split(':')

    expect(() =>
      decryptSecret(`${version}:${flipFirstByteBase64Url(iv)}:${tag}:${ct}`, {
        info: TEST_INFO
      })
    ).toThrow()
    expect(() =>
      decryptSecret(`${version}:${iv}:${flipFirstByteBase64Url(tag)}:${ct}`, {
        info: TEST_INFO
      })
    ).toThrow()
    expect(() =>
      decryptSecret(`${version}:${iv}:${tag}:${flipFirstByteBase64Url(ct)}`, {
        info: TEST_INFO
      })
    ).toThrow()
  })

  it('rejects unknown versions and malformed envelopes', () => {
    const sealed = encryptSecret('sensitive-signing-key', { info: TEST_INFO })
    const [, iv, tag, ct] = sealed.split(':')

    expect(() =>
      decryptSecret(`v2:${iv}:${tag}:${ct}`, { info: TEST_INFO })
    ).toThrow(/Unsupported secret box version/)
    expect(() =>
      decryptSecret(`v0:${iv}:${tag}:${ct}`, { info: TEST_INFO })
    ).toThrow(/Unsupported secret box version/)
    expect(() => decryptSecret('not-an-envelope', { info: TEST_INFO })).toThrow(
      /Invalid secret box format/
    )
    expect(() => decryptSecret(`v1:${iv}:${tag}`, { info: TEST_INFO })).toThrow(
      /Invalid secret box format/
    )
    expect(() =>
      decryptSecret(`v1:${iv}:${tag}:${ct}:extra`, { info: TEST_INFO })
    ).toThrow(/Invalid secret box format/)
    expect(() =>
      decryptSecret(`v1:short:${tag}:${ct}`, { info: TEST_INFO })
    ).toThrow(/Invalid secret box component length/)
    expect(() =>
      decryptSecret(`v1:${iv}:short:${ct}`, { info: TEST_INFO })
    ).toThrow(/Invalid secret box component length/)
    expect(() =>
      decryptSecret(`v1:${iv}+:${tag}:${ct}`, { info: TEST_INFO })
    ).toThrow(/Invalid secret box encoding/)
  })

  it('fails to decrypt with a different secret phase, HKDF info, or AAD', () => {
    const sealed = encryptSecret('signing-key', {
      secretPhase: 'secret-phase-a',
      info: PDS_SIGNING_KEY_HKDF_INFO,
      aad: 'did:web:alice.pds.test'
    })

    expect(
      decryptSecret(sealed, {
        secretPhase: 'secret-phase-a',
        info: PDS_SIGNING_KEY_HKDF_INFO,
        aad: 'did:web:alice.pds.test'
      })
    ).toBe('signing-key')

    expect(() =>
      decryptSecret(sealed, {
        secretPhase: 'secret-phase-b',
        info: PDS_SIGNING_KEY_HKDF_INFO,
        aad: 'did:web:alice.pds.test'
      })
    ).toThrow()

    expect(() =>
      decryptSecret(sealed, {
        secretPhase: 'secret-phase-a',
        info: 'activities.next/other-purpose/v1',
        aad: 'did:web:alice.pds.test'
      })
    ).toThrow()

    // Transplanting the envelope to a different DID (AAD) or omitting AAD must fail.
    expect(() =>
      decryptSecret(sealed, {
        secretPhase: 'secret-phase-a',
        info: PDS_SIGNING_KEY_HKDF_INFO,
        aad: 'did:web:bob.pds.test'
      })
    ).toThrow()
    expect(() =>
      decryptSecret(sealed, {
        secretPhase: 'secret-phase-a',
        info: PDS_SIGNING_KEY_HKDF_INFO
      })
    ).toThrow()
  })

  it('rejects an empty secret phase or empty HKDF info', () => {
    expect(() =>
      encryptSecret('test', { info: TEST_INFO, secretPhase: '' })
    ).toThrow(/ACTIVITIES_SECRET_PHASE/)
    expect(() => encryptSecret('test', { info: '' })).toThrow(/HKDF info/)
    expect(() =>
      deriveSecretKey({ info: '', secretPhase: 'secret-phase-a' })
    ).toThrow(/HKDF info/)
  })

  it('derives distinct domain-separated keys via deriveSecretKey', () => {
    const keySigning = deriveSecretKey({
      info: PDS_SIGNING_KEY_HKDF_INFO,
      secretPhase: 'secret-phase-a'
    })
    const keyBlobs = deriveSecretKey({
      info: PDS_BLOB_STORAGE_KEY_HKDF_INFO,
      secretPhase: 'secret-phase-a'
    })
    const keyOtherSecret = deriveSecretKey({
      info: PDS_BLOB_STORAGE_KEY_HKDF_INFO,
      secretPhase: 'secret-phase-b'
    })

    expect(keySigning).toHaveLength(32)
    expect(keyBlobs).toHaveLength(32)
    expect(keySigning.equals(keyBlobs)).toBe(false)
    expect(keyBlobs.equals(keyOtherSecret)).toBe(false)
  })
})
