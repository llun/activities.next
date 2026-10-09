import omit from 'lodash/omit'

import { MockActor } from '@/lib/stub/actor'
import {
  ActorProfile,
  getActorProfile,
  getActorURL,
  getMention,
  getMentionDomainFromActorID,
  getMentionFromActorID
} from '@/lib/types/domain/actor'

describe('Actor', () => {
  describe('getActorProfile', () => {
    it('returns actor without keys and account', () => {
      const actor = MockActor({})
      expect(getActorProfile(actor)).toEqual(
        omit(actor, ['privateKey', 'publicKey', 'account', 'updatedAt'])
      )
    })
  })

  describe('getMention', () => {
    it.each([
      { withDomain: false, expected: '@me' },
      { withDomain: true, expected: '@me@chat.llun.dev' }
    ])(
      'returns mention (withDomain: $withDomain)',
      ({ withDomain, expected }) => {
        const actor = MockActor({})
        expect(getMention(actor, withDomain)).toEqual(expected)
      }
    )
  })

  describe('getActorURL', () => {
    it.each([
      { withDomain: false, expected: 'https://chat.llun.dev/@me' },
      { withDomain: true, expected: 'https://chat.llun.dev/@me@chat.llun.dev' }
    ])(
      'returns actor url (withDomain: $withDomain)',
      ({ withDomain, expected }) => {
        const actor = MockActor({})
        expect(getActorURL(actor, withDomain)).toEqual(expected)
      }
    )
  })

  describe('getMentionDomainFromActorID', () => {
    it('returns mention domain from actor id', () => {
      expect(getMentionDomainFromActorID('https://chat.llun.dev/me')).toEqual(
        '@chat.llun.dev'
      )
    })
  })

  describe('getMentionFromActorID', () => {
    it.each([
      { withDomain: false, expected: '@me' },
      { withDomain: true, expected: '@me@chat.llun.me' }
    ])(
      'returns mention from actor url (withDomain: $withDomain)',
      ({ withDomain, expected }) => {
        expect(
          getMentionFromActorID('https://chat.llun.me/me', withDomain)
        ).toEqual(expected)
      }
    )
  })

  describe('ActorProfile with emoji tags', () => {
    it('parses actor profile with emoji tags', () => {
      const profile = ActorProfile.parse({
        id: 'https://chat.llun.dev/users/me',
        username: 'me',
        domain: 'chat.llun.dev',
        followersUrl: 'https://chat.llun.dev/users/me/followers',
        inboxUrl: 'https://chat.llun.dev/users/me/inbox',
        sharedInboxUrl: 'https://chat.llun.dev/inbox',
        followingCount: 0,
        followersCount: 0,
        statusCount: 0,
        lastStatusAt: 0,
        createdAt: Date.now(),
        tags: [
          {
            type: 'emoji',
            name: ':blobcat:',
            value: 'https://example.com/emojis/blobcat.png'
          }
        ]
      })
      expect(profile.tags).toEqual([
        {
          type: 'emoji',
          name: ':blobcat:',
          value: 'https://example.com/emojis/blobcat.png'
        }
      ])
    })
  })
})
