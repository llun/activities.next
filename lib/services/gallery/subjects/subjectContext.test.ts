import { withTimeZone } from '@/lib/testing/withTimeZone'

import { countryNameOf, monthNameOf, toSubjectContext } from './subjectContext'

describe('toSubjectContext', () => {
  it('keeps an upper-cased two-letter country and the UTC month, whatever the server’s zone', async () => {
    // 23:30 UTC on 30 April is already May in Tokyo; the month is UTC's.
    const context = await withTimeZone('Asia/Tokyo', () =>
      toSubjectContext({
        placeCountryCode: ' jp ',
        takenAt: Date.UTC(2026, 3, 30, 23, 30)
      })
    )
    expect(context).toEqual({ countryCode: 'JP', month: 4 })
  })

  it.each([
    ['no country and no date', null, null],
    ['a three-letter code', 'JPN', null],
    ['a code with digits', 'J1', null],
    ['a date that is not a number', 'X', Number.NaN],
    ['a date out of range', '', 8.64e15 + 1]
  ])('answers nothing for %s', (_, placeCountryCode, takenAt) => {
    expect(toSubjectContext({ placeCountryCode, takenAt })).toEqual({
      countryCode: null,
      month: null
    })
  })

  it('carries either one alone', () => {
    expect(toSubjectContext({ placeCountryCode: 'TH', takenAt: null })).toEqual(
      { countryCode: 'TH', month: null }
    )
    expect(
      toSubjectContext({
        placeCountryCode: null,
        takenAt: Date.UTC(2026, 11, 1)
      })
    ).toEqual({ countryCode: null, month: 12 })
  })
})

describe('countryNameOf and monthNameOf', () => {
  it('names them in English, whatever the server’s zone', async () => {
    expect(countryNameOf('JP')).toBe('Japan')
    expect(
      await withTimeZone('America/Los_Angeles', () => monthNameOf(5))
    ).toBe('May')
  })

  it('falls back when Intl cannot name them', () => {
    const displayNames = vi
      .spyOn(Intl, 'DisplayNames')
      .mockImplementation(() => {
        throw new RangeError('no region data')
      })
    const toLocale = vi
      .spyOn(Date.prototype, 'toLocaleString')
      .mockImplementation(() => {
        throw new RangeError('no locale data')
      })
    try {
      expect(countryNameOf('JP')).toBe('JP')
      expect(monthNameOf(5)).toBeNull()
    } finally {
      displayNames.mockRestore()
      toLocale.mockRestore()
    }
  })

  it('names no month outside 1 to 12', () => {
    expect(monthNameOf(0)).toBeNull()
    expect(monthNameOf(13)).toBeNull()
  })
})
