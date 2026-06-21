import { MockActor } from '@/lib/stub/actor'
import { getPersonFromActor } from '@/lib/utils/getPersonFromActor'

describe('getPersonFromActor', () => {
  it('returns person', () => {
    const actor = MockActor({})
    expect(getPersonFromActor(actor)).toEqual({
      '@context': [
        'https://www.w3.org/ns/activitystreams',
        'https://w3id.org/security/v1',
        'https://w3id.org/fep/7aa9'
      ],
      id: 'https://chat.llun.dev/users/me',
      type: 'Person',
      following: `https://chat.llun.dev/users/me/following`,
      followers: `https://chat.llun.dev/users/me/followers`,
      inbox: `https://chat.llun.dev/users/me/inbox`,
      outbox: `https://chat.llun.dev/users/me/outbox`,
      featured: `https://chat.llun.dev/users/me/collections/featured`,
      featuredTags: `https://chat.llun.dev/users/me/collections/tags`,
      featuredCollections: `https://chat.llun.dev/users/me/collections/featured-collections`,
      preferredUsername: 'me',
      name: '',
      summary: '',
      url: `https://chat.llun.dev/@me`,
      published: expect.toBeString(),
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
})
