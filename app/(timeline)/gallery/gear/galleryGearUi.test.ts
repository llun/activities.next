import {
  formatGearDay,
  formatGearMonth,
  getGearBrandModel,
  getGearHref,
  getGearSubline,
  getGearUsedLabel
} from './galleryGearUi'

describe('galleryGearUi', () => {
  it('formats months and days in UTC', () => {
    // 23:30 UTC on 31 Mar is still March, whatever zone the reader is in.
    expect(formatGearMonth(Date.UTC(2024, 2, 31, 23, 30))).toBe('Mar 2024')
    expect(formatGearDay(Date.UTC(2024, 2, 14, 23, 30))).toBe('14 Mar 2024')
  })

  describe('getGearUsedLabel', () => {
    it.each([
      {
        description: 'reads "to now" for gear in use',
        gear: { firstUsedAt: Date.UTC(2024, 2, 14), retiredAt: null },
        expected: 'Mar 2024 to now'
      },
      {
        description: 'ends at the retirement month for retired gear',
        gear: {
          firstUsedAt: Date.UTC(2022, 2, 1),
          retiredAt: Date.UTC(2024, 1, 10)
        },
        expected: 'Mar 2022 to Feb 2024'
      },
      {
        description: 'collapses a range inside one month',
        gear: {
          firstUsedAt: Date.UTC(2024, 1, 1),
          retiredAt: Date.UTC(2024, 1, 20)
        },
        expected: 'Feb 2024'
      },
      {
        description: 'is a dash for gear with nothing posted',
        gear: { firstUsedAt: null, retiredAt: null },
        expected: '—'
      },
      {
        description: 'is a dash when only a retirement date is known',
        gear: { firstUsedAt: null, retiredAt: 5 },
        expected: '—'
      }
    ])('$description', ({ gear, expected }) => {
      expect(getGearUsedLabel(gear)).toBe(expected)
    })
  })

  it('joins brand and model', () => {
    expect(getGearSubline({ brand: 'Sony', model: 'ILCE-1' })).toBe(
      'Sony · ILCE-1'
    )
    expect(getGearBrandModel({ brand: 'Sony', model: 'ILCE-1' })).toBe(
      'Sony ILCE-1'
    )
    expect(getGearSubline({ brand: null, model: 'ILCE-1' })).toBe('ILCE-1')
    expect(getGearSubline({ brand: null, model: null })).toBe('')
  })

  it('encodes the id in the href', () => {
    expect(getGearHref('a/b')).toBe('/gallery/gear/a%2Fb')
  })
})
