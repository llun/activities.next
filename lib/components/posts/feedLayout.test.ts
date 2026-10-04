import {
  MOBILE_FEED_SURFACE_CLASS,
  MOBILE_INSET_CARD_CLASS,
  MOBILE_INSET_CARD_FRAME_CLASS,
  MOBILE_INSET_FEED_CLASS,
  MOBILE_INSET_STACK_CLASS
} from './feedLayout'

// This class string is the mobile layout contract consumed by ~20 surfaces and
// by Posts itself. jsdom cannot lay the geometry out, so the rendered
// measurements are browser-verified; pinning the tokens here is what stops a
// "cleanup" from dropping `max-md:w-auto` (without it a `w-full` frame only
// shifts left) or swapping the viewport-relative margin for a fixed gutter.
describe('mobile feed surface contract', () => {
  it('spans the viewport and drops the mobile frame', () => {
    expect(MOBILE_FEED_SURFACE_CLASS.split(' ')).toEqual([
      'max-md:mx-[calc(50%_-_50vw)]',
      'max-md:w-auto',
      'max-md:rounded-none',
      'max-md:border-0',
      'max-md:shadow-none'
    ])
  })
})

// The logged-out status page's inset cards. Every token is `max-md:`-scoped so
// the desktop frame is untouched, and they are the exact inverse of the feed
// surface above (the stack drops the frame the feed surface also drops, then
// the cards put one back), so a token that lost its prefix would reach desktop.
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

  it('stacks the cards 24px apart on a frame that paints nothing', () => {
    expect(tokens(MOBILE_INSET_STACK_CLASS)).toEqual([
      'max-md:flex',
      'max-md:flex-col',
      'max-md:gap-6',
      'max-md:rounded-none',
      'max-md:border-0',
      'max-md:bg-transparent',
      'max-md:shadow-none'
    ])
  })

  it('frames each card with the rounded border the footer card has', () => {
    expect(tokens(MOBILE_INSET_CARD_FRAME_CLASS)).toEqual([
      'max-md:rounded-2xl',
      'max-md:border',
      'max-md:shadow-sm'
    ])
    expect(tokens(MOBILE_INSET_CARD_CLASS)).toEqual([
      ...tokens(MOBILE_INSET_CARD_FRAME_CLASS),
      'max-md:bg-background/80'
    ])
  })

  it('turns a feed surface into a card in the column: no viewport margin, the card frame', () => {
    // Merged after `MOBILE_FEED_SURFACE_CLASS`, so every token here must be on
    // a utility that class sets — otherwise nothing is taken back.
    expect(tokens(MOBILE_INSET_FEED_CLASS)).toEqual([
      'max-md:mx-0',
      ...tokens(MOBILE_INSET_CARD_FRAME_CLASS)
    ])
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
