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
    it('reads "to now" for gear in use', () => {
      expect(
        getGearUsedLabel({
          firstUsedAt: Date.UTC(2024, 2, 14),
          retiredAt: null
        })
      ).toBe('Mar 2024 to now')
    })

    it('ends at the retirement month for retired gear', () => {
      expect(
        getGearUsedLabel({
          firstUsedAt: Date.UTC(2022, 2, 1),
          retiredAt: Date.UTC(2024, 1, 10)
        })
      ).toBe('Mar 2022 to Feb 2024')
    })

    it('collapses a range inside one month', () => {
      expect(
        getGearUsedLabel({
          firstUsedAt: Date.UTC(2024, 1, 1),
          retiredAt: Date.UTC(2024, 1, 20)
        })
      ).toBe('Feb 2024')
    })

    it('is a dash for gear with nothing posted', () => {
      expect(getGearUsedLabel({ firstUsedAt: null, retiredAt: null })).toBe('—')
      expect(getGearUsedLabel({ firstUsedAt: null, retiredAt: 5 })).toBe('—')
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
