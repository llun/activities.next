import {
  getActorIdUsername,
  isOpaqueActorUsername
} from '@/lib/utils/activitypubActor'

describe('activitypubActor utils', () => {
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
    expect(isOpaqueActorUsername(actorId, 'alice.example')).toBe(false)
  })
})
