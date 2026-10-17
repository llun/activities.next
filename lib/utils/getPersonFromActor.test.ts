import { compactActivityPub } from '@/lib/activities/jsonld'
import { MockActor } from '@/lib/stub/actor'
import { Actor as ActivityPubActor } from '@/lib/types/activitypub'
import { getActorProfileFields } from '@/lib/utils/activitypubActor'
import { getPersonFromActor } from '@/lib/utils/getPersonFromActor'

describe('getPersonFromActor', () => {
  it('returns person', () => {
    const actor = MockActor({})
    expect(getPersonFromActor(actor)).toEqual({
      '@context': [
        'https://www.w3.org/ns/activitystreams',
        'https://w3id.org/security/v1',
        { manuallyApprovesFollowers: 'as:manuallyApprovesFollowers' }
      ],
      id: 'https://chat.llun.dev/users/me',
      type: 'Person',
      following: `https://chat.llun.dev/users/me/following`,
      followers: `https://chat.llun.dev/users/me/followers`,
      inbox: `https://chat.llun.dev/users/me/inbox`,
      outbox: `https://chat.llun.dev/users/me/outbox`,
      featured: `https://chat.llun.dev/users/me/collections/featured`,
      featuredTags: `https://chat.llun.dev/users/me/collections/tags`,
      preferredUsername: 'me',
      name: '',
      summary: '',
      url: `https://chat.llun.dev/@me`,
      published: expect.toBeString(),
      manuallyApprovesFollowers: false,
      publicKey: {
        id: `https://chat.llun.dev/users/me#main-key`,
        owner: 'https://chat.llun.dev/users/me',
        publicKeyPem: expect.toBeString()
      },
      endpoints: {
        sharedInbox: `https://chat.llun.dev/inbox`
      }
    })
  })

  it('serializes custom emoji tags and includes toot:Emoji in @context', () => {
    const actor = MockActor({})
    const actorWithTags = {
      ...actor,
      name: 'Alice :blobcat:',
      tags: [
        {
          type: 'emoji' as const,
          name: ':blobcat:',
          value: 'https://chat.llun.dev/emojis/blobcat.png'
        }
      ]
    }
    const person = getPersonFromActor(actorWithTags)
    expect(person['@context']).toContainEqual({
      manuallyApprovesFollowers: 'as:manuallyApprovesFollowers',
      toot: 'http://joinmastodon.org/ns#',
      Emoji: 'toot:Emoji'
    })
    expect(person.tag).toEqual([
      {
        type: 'Emoji',
        id: 'https://chat.llun.dev/emojis/blobcat.png',
        name: ':blobcat:',
        updated: expect.toBeString(),
        icon: {
          type: 'Image',
          url: 'https://chat.llun.dev/emojis/blobcat.png'
        }
      }
    ])
  })

  it.each([
    [true, true],
    [false, false],
    [undefined, false]
  ])(
    'serializes manuallyApprovesFollowers %s as %s',
    (manuallyApprovesFollowers, expected) => {
      const actor = { ...MockActor({}), manuallyApprovesFollowers }
      expect(getPersonFromActor(actor).manuallyApprovesFollowers).toBe(expected)
    }
  )

  describe('profile fields', () => {
    const fields = [
      { name: 'Web', value: 'https://example.com/me' },
      { name: 'Pronouns', value: 'they <3 them' }
    ]

    it('omits attachment and the schema terms when there are no fields', () => {
      const person = getPersonFromActor(MockActor({}))
      expect(person).not.toHaveProperty('attachment')
      expect(JSON.stringify(person['@context'])).not.toContain('PropertyValue')
    })

    it('ignores a row with neither label nor content', () => {
      const person = getPersonFromActor({
        ...MockActor({}),
        fields: [{ name: ' ', value: '' }]
      })
      expect(person).not.toHaveProperty('attachment')
    })

    it('emits a PropertyValue per field with an HTML value', () => {
      const person = getPersonFromActor({ ...MockActor({}), fields })
      expect(person.attachment).toEqual([
        {
          type: 'PropertyValue',
          name: 'Web',
          value:
            '<a href="https://example.com/me" target="_blank" rel="nofollow noopener me" translate="no"><span class="invisible">https://</span><span class="">example.com/me</span><span class="invisible"></span></a>'
        },
        { type: 'PropertyValue', name: 'Pronouns', value: 'they &lt;3 them' }
      ])
    })

    it('does not federate verifiedAt', () => {
      const actor = MockActor({})
      const withVerification = getPersonFromActor({
        ...actor,
        fields: fields.map((field) => ({ ...field, verifiedAt: 1700000000000 }))
      })
      const without = getPersonFromActor({ ...actor, fields })

      expect(withVerification).toEqual(without)
      expect(JSON.stringify(withVerification)).not.toMatch(/verif/i)
    })

    it('does not federate linksCheckedAt', () => {
      const person = getPersonFromActor({
        ...MockActor({}),
        fields,
        linksCheckedAt: 1700000000000
      })

      expect(JSON.stringify(person)).not.toContain('linksCheckedAt')
    })

    it('declares the schema terms in the context only when there are fields', () => {
      const person = getPersonFromActor({ ...MockActor({}), fields })
      expect(person['@context']).toContainEqual({
        manuallyApprovesFollowers: 'as:manuallyApprovesFollowers',
        schema: 'http://schema.org#',
        PropertyValue: 'schema:PropertyValue',
        value: 'schema:value'
      })
    })

    it('survives the inbound compaction and actor parsing', async () => {
      const person = getPersonFromActor({ ...MockActor({}), fields })
      const compacted = await compactActivityPub(
        JSON.parse(JSON.stringify(person))
      )
      const parsed = ActivityPubActor.parse(compacted)
      expect(getActorProfileFields(parsed)).toEqual([
        {
          name: 'Web',
          value: expect.stringContaining('href="https://example.com/me"')
        },
        { name: 'Pronouns', value: 'they &lt;3 them' }
      ])
    })
  })
})
