import { MediaDetailsEntity } from '@/lib/services/medias/types'

import { parseMediaDetails, parseSubjectSuggestions } from './rows'

// A row stored before the model was told the country and month.
const OLD_ROW = {
  model: 'v1',
  generatedAt: '2026-10-08T10:00:00.000Z',
  checkedAgainst: 'gbif',
  candidates: [
    {
      name: 'Warbling White-eye',
      scientificName: 'Zosterops japonicus',
      category: 'bird',
      confidence: 0.81,
      taxonKey: '5232437',
      rank: 'SPECIES',
      taxonPath: ['Animalia', 'Chordata', 'Aves']
    }
  ],
  group: 'bird'
} as const

const subjectSuggestions = MediaDetailsEntity.shape.subjectSuggestions

describe('parseSubjectSuggestions', () => {
  it('reads a row stored before the place context as it always did', () => {
    const parsed = parseSubjectSuggestions(JSON.stringify(OLD_ROW))

    expect(parsed).toEqual(OLD_ROW)
    expect(parsed).not.toHaveProperty('context')
    expect(parsed?.candidates[0]).not.toHaveProperty('recordedInCountry')
    expect(subjectSuggestions.safeParse(parsed).success).toBe(true)
  })

  it('keeps the context and the country records', () => {
    const row = {
      ...OLD_ROW,
      candidates: [
        { ...OLD_ROW.candidates[0], recordedInCountry: false },
        { ...OLD_ROW.candidates[0], name: 'Other', recordedInCountry: null }
      ],
      context: { countryCode: 'JP', month: 5 }
    }

    const parsed = parseSubjectSuggestions(JSON.stringify(row))

    expect(parsed).toEqual(row)
    expect(subjectSuggestions.safeParse(parsed).success).toBe(true)
  })

  it('keeps a context with only one part known', () => {
    expect(
      parseSubjectSuggestions(
        JSON.stringify({ ...OLD_ROW, context: { countryCode: null, month: 2 } })
      )?.context
    ).toEqual({ countryCode: null, month: 2 })
  })

  it('drops a context or record it cannot read', () => {
    const parsed = parseSubjectSuggestions(
      JSON.stringify({
        ...OLD_ROW,
        candidates: [{ ...OLD_ROW.candidates[0], recordedInCountry: 'no' }],
        context: { countryCode: 'japan', month: 13 }
      })
    )

    expect(parsed).not.toHaveProperty('context')
    expect(parsed?.candidates[0].recordedInCountry).toBeNull()
  })
})

describe('subject rank parsing', () => {
  it('returns null for legacy rows and preserves stored ranks', () => {
    const row = {
      id: 1,
      actorId: 'actor',
      original: 'legacy.jpg',
      originalBytes: 10,
      originalMimeType: 'image/jpeg',
      originalMetaData: '{}'
    }
    expect(parseMediaDetails(row).subjectTaxonRank).toBeNull()
    expect(
      parseMediaDetails({ ...row, subjectTaxonRank: 'GENUS' }).subjectTaxonRank
    ).toBe('GENUS')
  })
})
