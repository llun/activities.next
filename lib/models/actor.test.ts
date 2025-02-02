import omit from 'lodash/omit'

import { MockActor } from '@/lib/stub/actor'

import {
  getActorProfile,
  getActorURL,
  getMention,
  getMentionDomainFromActorID,
  getMentionFromActorID
} from './actor'

describe('Actor', () => {
  describe('#getActorProfile', () => {
    it('returns actor without keys and account', () => {
      const actor = MockActor({})
      expect(getActorProfile(actor)).toEqual(
        omit(actor, ['privateKey', 'publicKey', 'account', 'updatedAt'])
      )
    })
  })

  describe('#getMention', () => {
    it('returns mention', () => {
      const actor = MockActor({})
      expect(getMention(actor)).toEqual(`@${actor.username}`)
    })

    it('returns mention with domain', () => {
      const actor = MockActor({})
      expect(getMention(actor, true)).toEqual(
        `@${actor.username}@${actor.domain}`
      )
    })
  })

  describe('#getActorURL', () => {
    it('returns actor url', () => {
      const actor = MockActor({})
      expect(getActorURL(actor)).toEqual('https://chat.llun.dev/@me')
    })

    it('returns actor url with domain', () => {
      const actor = MockActor({})
      expect(getActorURL(actor, true)).toEqual(
        'https://chat.llun.dev/@me@chat.llun.dev'
      )
    })
  })

  describe('#getMentionDomainFromActorID', () => {
    it('returns mention domain from actor id', () => {
      expect(getMentionDomainFromActorID('https://chat.llun.dev/me')).toEqual(
        '@chat.llun.dev'
      )
    })
  })

  describe('#getMentionFromActorURL', () => {
    it('returns mention from actor url', () => {
      expect(getMentionFromActorID('https://chat.llun.me/me')).toEqual('@me')
    })

    it('returns mention from actor url with domain', () => {
      expect(getMentionFromActorID('https://chat.llun.me/me', true)).toEqual(
        '@me@chat.llun.me'
      )
    })
  })
})
