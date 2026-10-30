import { Actor as ActivityPubActor } from '@/lib/types/activitypub'
import {
  REMOTE_PROFILE_FIELD_LIMIT,
  REMOTE_PROFILE_FIELD_MAX_LENGTH,
  getActorIdUsername,
  getActorProfileFields,
  getActorProfileFromPerson,
  isOpaqueActorUsername,
  isOpaqueActorUsernameValue
} from '@/lib/utils/activitypubActor'
import { sanitizeText } from '@/lib/utils/text/sanitizeText'

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

  describe('getActorProfileFields', () => {
    const personWith = (attachment: unknown) =>
      ({
        id: 'https://remote.test/users/alice',
        type: 'Person',
        preferredUsername: 'alice',
        inbox: 'https://remote.test/users/alice/inbox',
        outbox: 'https://remote.test/users/alice/outbox',
        publicKey: {
          id: 'https://remote.test/users/alice#main-key',
          owner: 'https://remote.test/users/alice',
          publicKeyPem: 'public-key'
        },
        attachment
      }) as ActivityPubActor

    const field = (index: number) => ({
      type: 'PropertyValue',
      name: `Name ${index}`,
      value: `Value ${index}`
    })

    it("keeps Mastodon's limits for a remote account", () => {
      expect(REMOTE_PROFILE_FIELD_LIMIT).toBe(50)
      expect(REMOTE_PROFILE_FIELD_MAX_LENGTH).toBe(2047)
    })

    it('keeps the first 50 fields, in order', () => {
      const fields = getActorProfileFields(
        personWith(Array.from({ length: 60 }, (_, index) => field(index)))
      )
      expect(fields).toHaveLength(REMOTE_PROFILE_FIELD_LIMIT)
      expect(fields.map((item) => item.name)).toEqual(
        Array.from({ length: 50 }, (_, index) => `Name ${index}`)
      )
    })

    it('does not count other attachment types against the limit', () => {
      const attachment = Array.from({ length: 60 }, (_, index) => [
        { type: 'Note', name: `Not a field ${index}` },
        field(index)
      ]).flat()
      const fields = getActorProfileFields(personWith(attachment))
      expect(fields).toHaveLength(50)
      expect(fields[0]).toEqual({ name: 'Name 0', value: 'Value 0' })
      expect(fields[49]).toEqual({ name: 'Name 49', value: 'Value 49' })
    })

    it('ignores attachments that are not a valid PropertyValue', () => {
      expect(
        getActorProfileFields(
          personWith([
            { type: 'Document', url: 'https://remote.test/a.png' },
            { type: 'SomethingElse', name: 'ignored', value: 'ignored' },
            { type: 'PropertyValue', name: 'No value' },
            { type: 'PropertyValue', name: { en: 'Object' }, value: 'x' },
            field(1)
          ])
        )
      ).toEqual([{ name: 'Name 1', value: 'Value 1' }])
    })

    it('takes 50 PropertyValues before validating, as Mastodon does', () => {
      const malformed = Array.from({ length: 50 }, (_, i) => ({
        type: 'PropertyValue',
        name: `Bad ${i}`
      }))
      expect(
        getActorProfileFields(personWith([...malformed, field(1)]))
      ).toEqual([])
    })

    it('reads a single attachment that is not in an array', () => {
      expect(getActorProfileFields(personWith(field(1)))).toEqual([
        { name: 'Name 1', value: 'Value 1' }
      ])
    })

    it('strips and cuts a 1 MB name and value to 2047 characters', () => {
      const [capped] = getActorProfileFields(
        personWith([
          {
            type: 'PropertyValue',
            name: `  ${'n'.repeat(1024 * 1024)}`,
            value: `${'v'.repeat(1024 * 1024)}  `
          }
        ])
      )
      expect(capped.name).toBe('n'.repeat(REMOTE_PROFILE_FIELD_MAX_LENGTH))
      expect(capped.value).toBe('v'.repeat(REMOTE_PROFILE_FIELD_MAX_LENGTH))
    })

    it('counts characters, so a cut never splits a surrogate pair', () => {
      const [capped] = getActorProfileFields(
        personWith([
          {
            type: 'PropertyValue',
            name: '\u{1F600}'.repeat(3000),
            value: `a${'\u{1F600}'.repeat(3000)}`
          }
        ])
      )
      expect([...capped.name]).toHaveLength(REMOTE_PROFILE_FIELD_MAX_LENGTH)
      expect(capped.name).toBe('\u{1F600}'.repeat(2047))
      expect([...capped.value]).toHaveLength(REMOTE_PROFILE_FIELD_MAX_LENGTH)
      expect(capped.value).toBe(`a${'\u{1F600}'.repeat(2046)}`)
    })

    it('keeps a value cut inside its markup safe once sanitized', () => {
      const [capped] = getActorProfileFields(
        personWith([
          {
            type: 'PropertyValue',
            name: 'Website',
            value: `<p><b><a href="https://remote.test/${'x'.repeat(2100)}" onclick="alert(1)">link</a></b></p>`
          }
        ])
      )
      expect(capped.value).toHaveLength(REMOTE_PROFILE_FIELD_MAX_LENGTH)
      expect(capped.value.endsWith('x')).toBe(true)
      const html = sanitizeText(capped.value)
      expect(html).not.toContain('onclick')
      expect(html).not.toContain('<a')
      expect(html).toBe('<p><b></b></p>')
    })
  })
})
