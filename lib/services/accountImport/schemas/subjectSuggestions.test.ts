import { ownMediaLineSchema } from '@/lib/services/accountImport/schemas'

const suggestionsSchema = ownMediaLineSchema.shape.subjectSuggestions

const candidate = {
  name: 'Japanese White-eye',
  scientificName: 'Zosterops japonicus',
  category: 'bird',
  confidence: 0.91,
  taxonKey: '2493052',
  rank: 'SPECIES',
  taxonPath: ['Animalia', 'Chordata', 'Aves']
}

const base = {
  model: 'demo-model',
  generatedAt: '2026-05-14T08:00:00.000Z',
  checkedAgainst: 'gbif',
  candidates: [candidate],
  group: 'bird'
}

describe('account import subject suggestions', () => {
  it('keeps the place context and the per-candidate country record', () => {
    const parsed = suggestionsSchema.parse({
      ...base,
      candidates: [
        { ...candidate, recordedInCountry: true },
        { ...candidate, name: 'Rare look-alike', recordedInCountry: false }
      ],
      context: { countryCode: 'JP', month: 5 }
    })

    expect(parsed?.context).toEqual({ countryCode: 'JP', month: 5 })
    expect(parsed?.candidates.map((c) => c.recordedInCountry)).toEqual([
      true,
      false
    ])
  })

  it('reads the nulls an export writes for an unknown country, month or record', () => {
    const parsed = suggestionsSchema.parse({
      ...base,
      candidates: [{ ...candidate, recordedInCountry: null }],
      context: { countryCode: null, month: null }
    })

    expect(parsed?.context).toEqual({ countryCode: null, month: null })
    expect(parsed?.candidates[0].recordedInCountry).toBeNull()
  })

  it('still reads an archive written before the context existed', () => {
    const parsed = suggestionsSchema.parse(base)

    expect(parsed).not.toHaveProperty('context')
    expect(parsed?.candidates[0]).not.toHaveProperty('recordedInCountry')
  })

  it('refuses a malformed country code or month', () => {
    expect(() =>
      suggestionsSchema.parse({
        ...base,
        context: { countryCode: 'japan', month: 5 }
      })
    ).toThrow()
    expect(() =>
      suggestionsSchema.parse({
        ...base,
        context: { countryCode: 'JP', month: 13 }
      })
    ).toThrow()
  })
})
