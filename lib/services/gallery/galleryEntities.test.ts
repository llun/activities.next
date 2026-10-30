import {
  parseGalleryDayKey,
  toSubjectKey,
  toUtcDay
} from '@/lib/services/gallery/galleryEntities'

describe('toSubjectKey', () => {
  it.each([
    {
      description: 'prefers the scientific name',
      subject: { name: 'Common Kingfisher', scientificName: 'Alcedo atthis' },
      expected: 'sci:alcedo atthis'
    },
    {
      description: 'ignores case in the scientific name',
      subject: { name: 'Kingfisher', scientificName: 'ALCEDO Atthis' },
      expected: 'sci:alcedo atthis'
    },
    {
      description: 'trims and collapses whitespace',
      subject: { name: null, scientificName: '  Alcedo \t  atthis \n' },
      expected: 'sci:alcedo atthis'
    },
    {
      description: 'falls back to the common name',
      subject: { name: 'Red  Fox ', scientificName: null },
      expected: 'name:red fox'
    },
    {
      description: 'treats a blank scientific name as absent',
      subject: { name: 'Red Fox', scientificName: '   ' },
      expected: 'name:red fox'
    },
    {
      description: 'lowercases non-ASCII letters',
      subject: { name: 'ÉCUREUIL Roux', scientificName: null },
      expected: 'name:écureuil roux'
    },
    {
      description: 'treats composed and decomposed accents as one',
      subject: { name: 'Écureuil', scientificName: null },
      expected: 'name:écureuil'
    },
    {
      description: 'keeps non-Latin scripts',
      subject: { name: 'カワセミ', scientificName: null },
      expected: 'name:カワセミ'
    },
    {
      description: 'is null with no names',
      subject: { name: null, scientificName: null },
      expected: null
    },
    {
      description: 'is null for blank names',
      subject: { name: ' ', scientificName: '' },
      expected: null
    },
    { description: 'is null for no subject', subject: null, expected: null }
  ])('$description', ({ subject, expected }) => {
    expect(toSubjectKey(subject)).toBe(expected)
  })
})

describe('toUtcDay', () => {
  it.each([
    {
      description: 'an ISO date-time in UTC',
      value: '2025-10-04T12:30:00Z',
      expected: '2025-10-04'
    },
    {
      description: 'an ISO date-time in another zone, by its UTC day',
      value: '2025-10-05T01:30:00+14:00',
      expected: '2025-10-04'
    },
    {
      description: 'a bare ISO date',
      value: '2025-02-28',
      expected: '2025-02-28'
    },
    {
      description: 'epoch milliseconds',
      value: 1760000000000,
      expected: '2025-10-09'
    },
    { description: 'epoch zero', value: 0, expected: '1970-01-01' },
    { description: 'null', value: null, expected: null },
    { description: 'undefined', value: undefined, expected: null },
    { description: 'garbage', value: 'not a date', expected: null },
    { description: 'an empty string', value: '', expected: null }
  ])('$description', ({ value, expected }) => {
    expect(toUtcDay(value)).toBe(expected)
  })
})

describe('parseGalleryDayKey', () => {
  it.each([
    {
      description: 'a dated key',
      key: '2025-10-04',
      expected: { day: '2025-10-04', uploaded: false }
    },
    {
      description: 'an uploaded key',
      key: 'uploaded:2025-10-04',
      expected: { day: '2025-10-04', uploaded: true }
    },
    {
      description: 'a leap day',
      key: '2024-02-29',
      expected: { day: '2024-02-29', uploaded: false }
    },
    {
      description: 'a day that does not exist',
      key: '2025-02-30',
      expected: null
    },
    {
      description: 'a leap day in a non-leap year',
      key: '2025-02-29',
      expected: null
    },
    { description: 'the prefix alone', key: 'uploaded:', expected: null },
    {
      description: 'the prefix without a day',
      key: 'uploaded:2025-10',
      expected: null
    },
    { description: 'a month alone', key: '2025-10', expected: null },
    {
      description: 'a full timestamp',
      key: '2025-10-04T00:00:00Z',
      expected: null
    },
    { description: 'a leading space', key: ' 2025-10-04', expected: null },
    {
      description: 'an unknown prefix',
      key: 'taken:2025-10-04',
      expected: null
    }
  ])('parses $description', ({ key, expected }) => {
    expect(parseGalleryDayKey(key)).toEqual(expected)
  })
})
