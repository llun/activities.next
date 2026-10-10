import { ALL_MEDIA_PATH, getAllMediaPath } from './allMediaPath'

describe('getAllMediaPath', () => {
  it('is the bare path without a query', () => {
    expect(getAllMediaPath({})).toBe(ALL_MEDIA_PATH)
    expect(getAllMediaPath()).toBe('/gallery/media')
  })

  it('keeps every query key in order', () => {
    expect(getAllMediaPath({ category: 'bird', show: 'hidden' })).toBe(
      '/gallery/media?category=bird&show=hidden'
    )
  })

  it('keeps a repeated key and skips an undefined one', () => {
    expect(
      getAllMediaPath({ category: ['bird', 'mammal'], show: undefined })
    ).toBe('/gallery/media?category=bird&category=mammal')
  })

  it('encodes values', () => {
    expect(getAllMediaPath({ q: 'a b&c' })).toBe('/gallery/media?q=a+b%26c')
  })
})
