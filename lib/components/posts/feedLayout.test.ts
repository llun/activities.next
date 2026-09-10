import {
  MOBILE_FEED_SURFACE_CLASS,
  MOBILE_FEED_SURFACE_SM_P5_CLASS
} from './feedLayout'

// These class strings are the mobile layout contract consumed by ~20 surfaces
// and by Posts itself. jsdom cannot lay the geometry out, so the rendered
// measurements are browser-verified; pinning the tokens here is what stops a
// "cleanup" from dropping `max-md:w-auto` (without it a `w-full` frame only
// shifts left) or the `sm`/`md` steps of the fitness variant.
describe('mobile feed surface contract', () => {
  it('drops the mobile frame and widens the frame owner to the screen edges', () => {
    expect(MOBILE_FEED_SURFACE_CLASS.split(' ')).toEqual([
      'max-md:-mx-4',
      'max-md:w-auto',
      'max-md:rounded-none',
      'max-md:border-0',
      'max-md:shadow-none'
    ])
  })

  it('tracks a p-4 sm:p-5 container and resets from md up', () => {
    expect(MOBILE_FEED_SURFACE_SM_P5_CLASS.split(' ')).toEqual([
      '-mx-4',
      'max-md:w-auto',
      'max-md:rounded-none',
      'max-md:border-0',
      'max-md:shadow-none',
      'sm:-mx-5',
      'md:mx-0'
    ])
  })
})
