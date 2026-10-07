import { Actor } from '@/lib/types/activitypub/actor'

describe('Actor', () => {
  const base = {
    id: 'https://remote.example/users/alice',
    type: 'Person' as const,
    preferredUsername: 'alice',
    inbox: 'https://remote.example/users/alice/inbox',
    outbox: 'https://remote.example/users/alice/outbox',
    publicKey: {
      id: 'https://remote.example/users/alice#main-key',
      owner: 'https://remote.example/users/alice',
      publicKeyPem: '-----BEGIN PUBLIC KEY-----\nMOCK\n-----END PUBLIC KEY-----'
    }
  }

  // A single-element `alsoKnownAs` array collapses to a scalar during JSON-LD
  // compaction, so the schema must tolerate a bare string and still normalise
  // to an array. This was the second cause of remote secure-mode profiles
  // 404ing after the actor fetch itself started succeeding.
  it.each([
    {
      description: 'array of aliases',
      input: ['https://old.example/users/alice'],
      expected: ['https://old.example/users/alice']
    },
    {
      description: 'single alias collapsed to a string',
      input: 'https://old.example/users/alice',
      expected: ['https://old.example/users/alice']
    }
  ])('accepts alsoKnownAs as $description', ({ input, expected }) => {
    const result = Actor.safeParse({ ...base, alsoKnownAs: input })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.alsoKnownAs).toEqual(expected)
    }
  })

  it('parses an actor without alsoKnownAs', () => {
    const result = Actor.safeParse(base)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.alsoKnownAs).toBeUndefined()
    }
  })

  // FEP-2c59 `webfinger` is only a hint; a malformed one must not cost the
  // whole actor.
  it.each([
    { input: 'alice@handle.example', expected: 'alice@handle.example' },
    { input: 42, expected: undefined },
    { input: { '@value': 'alice@handle.example' }, expected: undefined }
  ])('reads webfinger $input as $expected', ({ input, expected }) => {
    const result = Actor.safeParse({ ...base, webfinger: input })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.webfinger).toBe(expected)
    }
  })

  describe('publicKey arrays', () => {
    const key = (id: string, publicKeyPem: string) => ({
      id,
      owner: base.id,
      publicKeyPem
    })

    it('prefers the #main-key entry', () => {
      const result = Actor.safeParse({
        ...base,
        publicKey: [
          key(`${base.id}#key-2`, 'second-pem'),
          key(`${base.id}#main-key`, 'main-pem')
        ]
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.publicKey.publicKeyPem).toBe('main-pem')
      }
    })

    it('falls back to the first valid entry, ignoring non-key entries', () => {
      const result = Actor.safeParse({
        ...base,
        publicKey: [
          {
            id: `${base.id}#multikey`,
            type: 'Multikey',
            publicKeyMultibase: 'z6M'
          },
          key(`${base.id}#key-2`, 'second-pem'),
          key(`${base.id}#key-3`, 'third-pem')
        ]
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.publicKey.publicKeyPem).toBe('second-pem')
      }
    })

    it('rejects an empty array and an array with no valid key', () => {
      expect(Actor.safeParse({ ...base, publicKey: [] }).success).toBe(false)
      expect(
        Actor.safeParse({ ...base, publicKey: [{ id: 'x', type: 'Multikey' }] })
          .success
      ).toBe(false)
    })
  })
})
