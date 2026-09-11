import { MOBILE_FEED_SURFACE_CLASS } from './feedLayout'

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
