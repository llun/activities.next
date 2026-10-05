import {
  getActorIdUsername,
  getActorProfileFromPerson,
  isOpaqueActorUsername,
  isOpaqueActorUsernameValue
} from '@/lib/utils/activitypubActor'

describe('activitypubActor utils', () => {
  it('decodes a percent-encoded actor id segment', () => {
    expect(getActorIdUsername('https://remote.test/users/caf%C3%A9')).toBe(
      'café'
    )
  })

  it('falls back to the raw segment when the actor id is not valid percent-encoding', () => {
    expect(getActorIdUsername('https://evil.example/users/%FF')).toBe('%FF')
    expect(getActorIdUsername('https://evil.example/users/@100%')).toBe('100%')
    expect(isOpaqueActorUsername('https://evil.example/users/%FF', '%FF')).toBe(
      false
    )
  })

  it('detects strict UUID actor usernames only when they match the actor id', () => {
    const actorId =
      'https://hackers.pub/ap/actors/019382d3-63d7-7cf7-86e8-91e2551c306c'

    expect(getActorIdUsername(actorId)).toBe(
      '019382d3-63d7-7cf7-86e8-91e2551c306c'
    )
    expect(
      isOpaqueActorUsername(actorId, '019382d3-63d7-7cf7-86e8-91e2551c306c')
    ).toBe(true)
    expect(
      isOpaqueActorUsername(
        'https://hackers.pub/ap/actors/aaaaaaaa-000000000000000000000000000',
        'aaaaaaaa-000000000000000000000000000'
      )
    ).toBe(false)
    expect(isOpaqueActorUsername(actorId, 'hongminhee')).toBe(false)
  })

  it('detects DID actor usernames only when they match the actor id', () => {
    const actorId = 'https://bsky.brid.gy/ap/did:plc:alice'

    expect(isOpaqueActorUsername(actorId, 'did:plc:alice')).toBe(true)
    expect(isOpaqueActorUsername(actorId, 'alice')).toBe(false)
    expect(isOpaqueActorUsername(actorId, 'alice.example')).toBe(false)
  })

  it('detects standalone opaque username values', () => {
    expect(isOpaqueActorUsernameValue('did:plc:alice')).toBe(true)
    expect(
      isOpaqueActorUsernameValue('019382d3-63d7-7cf7-86e8-91e2551c306c')
    ).toBe(true)
    expect(
      isOpaqueActorUsernameValue('aaaaaaaa-000000000000000000000000000')
    ).toBe(false)
    expect(isOpaqueActorUsernameValue('alice')).toBe(false)
  })

  it('falls back to epoch time for invalid actor published dates', () => {
    expect(
      getActorProfileFromPerson({
        id: 'https://example.com/users/alice',
        type: 'Person',
        preferredUsername: 'alice',
        name: 'Alice',
        inbox: 'https://example.com/users/alice/inbox',
        outbox: 'https://example.com/users/alice/outbox',
        published: 'not-a-date',
        publicKey: {
          id: 'https://example.com/users/alice#main-key',
          owner: 'https://example.com/users/alice',
          publicKeyPem: 'public-key'
        }
      }).createdAt
    ).toBe(0)
  })
})
