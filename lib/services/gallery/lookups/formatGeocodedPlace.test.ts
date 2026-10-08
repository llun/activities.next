import nominatimThailand from './__fixtures__/nominatim-reverse-th.json'
import { formatGeocodedPlace } from './formatGeocodedPlace'

describe('formatGeocodedPlace', () => {
  it('names a recorded Nominatim answer by municipality and country', () => {
    expect(formatGeocodedPlace(nominatimThailand)).toEqual({
      name: 'หมูสี, ประเทศไทย',
      countryCode: 'TH'
    })
  })

  it.each([
    [
      'city first',
      { city: 'Chiang Mai', town: 'x', state: 'y', country: 'Thailand' },
      'Chiang Mai, Thailand'
    ],
    ['town', { town: 'Pak Chong', country: 'Thailand' }, 'Pak Chong, Thailand'],
    ['village', { village: 'Ban Noi', country: 'Laos' }, 'Ban Noi, Laos'],
    [
      'municipality',
      { municipality: 'Muang', county: 'z', country: 'Laos' },
      'Muang, Laos'
    ],
    [
      'county',
      { county: 'Kent', country: 'United Kingdom' },
      'Kent, United Kingdom'
    ],
    [
      'state district',
      { state_district: 'Upper Bavaria', state: 'Bavaria', country: 'Germany' },
      'Upper Bavaria, Germany'
    ],
    ['state', { state: 'Bavaria', country: 'Germany' }, 'Bavaria, Germany'],
    ['country only', { country: 'Iceland' }, 'Iceland'],
    ['no country', { city: 'Reykjavik' }, 'Reykjavik'],
    [
      'blank locality skipped',
      { city: '  ', town: 'Hvar', country: 'Croatia' },
      'Hvar, Croatia'
    ]
  ])('uses the first available locality: %s', (_label, address, name) => {
    expect(formatGeocodedPlace({ address })?.name).toBe(name)
  })

  it.each([
    ['th', 'TH'],
    ['GB', 'GB'],
    ['xyz', null],
    ['', null],
    ['1a', null]
  ])('reads the country code %j as %j', (code, expected) => {
    expect(
      formatGeocodedPlace({ address: { city: 'X', country_code: code } })
        ?.countryCode
    ).toBe(expected)
  })

  it('keeps a country code even when no name can be made', () => {
    expect(formatGeocodedPlace({ address: { country_code: 'is' } })).toEqual({
      name: null,
      countryCode: 'IS'
    })
  })

  it('truncates a long name to 255 characters', () => {
    const place = formatGeocodedPlace({
      address: { city: 'x'.repeat(400), country: 'Y' }
    })
    expect(place?.name).toHaveLength(255)
  })

  it.each([
    ['an error body', { error: 'Unable to geocode' }],
    ['an empty address', { address: {} }],
    ['null', null],
    ['a string', 'nope'],
    ['an array address', { address: [] }]
  ])('answers null for %s', (_label, raw) => {
    expect(formatGeocodedPlace(raw)).toBeNull()
  })
})
