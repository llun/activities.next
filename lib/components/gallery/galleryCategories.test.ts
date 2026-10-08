import { formatGalleryDate } from './galleryCategories'

describe('formatGalleryDate', () => {
  it.each([
    ['2026-10-07T23:30:00.000Z', '7 Oct 2026'],
    ['2026-01-01T00:00:00.000Z', '1 Jan 2026'],
    [null, ''],
    [undefined, ''],
    ['garbage', '']
  ])('formats %s as %s', (input, expected) => {
    expect(formatGalleryDate(input)).toBe(expected)
  })
})
