import {
  MOBILE_FEED_SURFACE_CLASS,
  MOBILE_INSET_CARD_CLASS,
  MOBILE_INSET_CARD_FRAME_CLASS,
  MOBILE_INSET_FEED_CLASS,
  MOBILE_INSET_STACK_CLASS
} from './feedLayout'

// The logged-out status page's inset cards. Every token is `max-md:`-scoped so
// the desktop frame is untouched, and they are the exact inverse of the feed
// surface (the stack drops the frame the feed surface also drops, then the
// cards put one back), so a token that lost its prefix would reach desktop.
describe('mobile inset card contract', () => {
  const tokens = (value: string) => value.split(' ')

  it('scopes every token below md', () => {
    for (const value of [
      MOBILE_INSET_STACK_CLASS,
      MOBILE_INSET_CARD_FRAME_CLASS,
      MOBILE_INSET_CARD_CLASS,
      MOBILE_INSET_FEED_CLASS
    ]) {
      tokens(value).forEach((token) => expect(token).toMatch(/^max-md:/))
    }
  })

  it('never spans the viewport like the feed surface does', () => {
    for (const token of tokens(MOBILE_FEED_SURFACE_CLASS).filter((t) =>
      /(mx-|w-auto)/.test(t)
    )) {
      expect(tokens(MOBILE_INSET_STACK_CLASS)).not.toContain(token)
      expect(tokens(MOBILE_INSET_CARD_CLASS)).not.toContain(token)
    }
  })
})
