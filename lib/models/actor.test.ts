import { MockActor } from '../stub/actor'

describe('Actor', () => {
  describe('#getActorPage', () => {
    it('returns actor url', () => {
      const actor = MockActor({})
      expect(actor.getActorPage()).toEqual('https://chat.llun.dev/@me')
    })

    it('returns actor url with domain', () => {
      const actor = MockActor({})
      expect(actor.getActorPage(true)).toEqual(
        'https://chat.llun.dev/@me@chat.llun.dev'
      )
    })
  })
})
