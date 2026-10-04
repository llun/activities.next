import { PROFILE_CARD_MOBILE_CLASS } from './profileLayout'

// The profile page and its loading skeleton share this class string, so a
// token dropped here changes both at once and no component test notices: jsdom
// cannot lay the geometry out. Pinning the tokens is what stops a "cleanup"
// from dropping `max-md:w-auto` (the viewport-relative margin only widens the
// card with it) or `max-md:border-x-0` (a side hairline at the screen edge).
describe('profile card mobile layout contract', () => {
  it('breaks out to the viewport width and drops the top and side frame', () => {
    expect(PROFILE_CARD_MOBILE_CLASS.split(' ')).toEqual([
      'max-md:mx-[calc(50%_-_50vw)]',
      'max-md:w-auto',
      'max-md:rounded-none',
      'max-md:border-x-0',
      'max-md:border-t-0'
    ])
  })
})
