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
})
