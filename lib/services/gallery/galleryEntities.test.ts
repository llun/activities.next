import { toSubjectKey } from '@/lib/services/gallery/galleryEntities'

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
