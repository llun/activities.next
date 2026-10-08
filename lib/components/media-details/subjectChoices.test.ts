import type { SubjectSuggestionsEntity } from '@/lib/client'

import {
  candidateToPicked,
  getHigherTaxon,
  getSubjectChoices,
  groupToPicked,
  toPercent
} from './subjectChoices'

const candidate = (
  name: string,
  confidence: number,
  overrides: Partial<SubjectSuggestionsEntity['candidates'][number]> = {}
): SubjectSuggestionsEntity['candidates'][number] => ({
  name,
  scientificName: null,
  category: 'bird',
  confidence,
  taxonKey: null,
  rank: null,
  taxonPath: [],
  ...overrides
})

const suggestions = (
  candidates: SubjectSuggestionsEntity['candidates'],
  group: SubjectSuggestionsEntity['group'] = 'bird'
): SubjectSuggestionsEntity => ({
  model: 'vision',
  generatedAt: '2026-10-08T10:00:00.000Z',
  checkedAgainst: 'gbif',
  candidates,
  group
})

describe('getSubjectChoices', () => {
  const list = suggestions([
    candidate('Warbling White-eye', 0.81),
    candidate('Swinhoe’s White-eye', 0.12)
  ])

  it('offers the species at or above the threshold, then the named group', () => {
    expect(getSubjectChoices(list, 70)).toEqual({
      species: [list.candidates[0]],
      group: { label: 'Bird', category: 'bird', named: true }
    })
  })

  it('counts a candidate exactly on the threshold', () => {
    expect(getSubjectChoices(list, 81).species).toHaveLength(1)
    expect(getSubjectChoices(list, 85).species).toHaveLength(0)
  })

  it('offers only the group guess below the threshold', () => {
    expect(getSubjectChoices(list, 90)).toEqual({
      species: [],
      group: { label: 'Bird', category: 'bird', named: false }
    })
  })

  it('falls back to the top candidate’s category when the model gave no group', () => {
    expect(
      getSubjectChoices(
        suggestions([candidate('Otter', 0.9, { category: 'mammal' })], null),
        70
      ).group
    ).toEqual({ label: 'Mammal', category: 'mammal', named: true })
  })

  it('offers nothing without suggestions or any kind of subject', () => {
    expect(getSubjectChoices(null, 70)).toEqual({ species: [], group: null })
    expect(getSubjectChoices(suggestions([], null), 70)).toEqual({
      species: [],
      group: null
    })
  })
})

describe('picked subjects', () => {
  it('turns a candidate into the draft’s empty-string shape', () => {
    expect(candidateToPicked(candidate('Heron', 0.9))).toEqual({
      name: 'Heron',
      scientificName: '',
      category: 'bird',
      taxonKey: '',
      taxonPath: []
    })
    expect(
      candidateToPicked(
        candidate('Heron', 0.9, {
          scientificName: 'Ardea cinerea',
          taxonKey: '2480826',
          taxonPath: ['Animalia']
        })
      )
    ).toMatchObject({
      scientificName: 'Ardea cinerea',
      taxonKey: '2480826',
      taxonPath: ['Animalia']
    })
  })

  it('names a group with no species or taxon', () => {
    expect(groupToPicked('Bird', 'bird')).toEqual({
      name: 'Bird',
      scientificName: '',
      category: 'bird',
      taxonKey: '',
      taxonPath: []
    })
  })

  it.each([
    [0.814, 81],
    [0.005, 1],
    [1.4, 100],
    [-1, 0]
  ])('rounds the confidence %d to %d%%', (confidence, expected) => {
    expect(toPercent(confidence)).toBe(expected)
  })
})

describe('getHigherTaxon', () => {
  it.each([
    ['Zosterops japonicus', [], { name: 'Zosterops', rank: 'genus' }],
    [
      null,
      ['Animalia', 'Aves', 'Zosteropidae'],
      { name: 'Zosteropidae', rank: 'family' }
    ],
    [
      'Zosterops',
      ['Animalia', 'Aves', 'Zosteropidae'],
      { name: 'Zosteropidae', rank: 'family' }
    ],
    [null, [], null]
  ])('picks the broad taxon for %j and %j', (name, path, expected) => {
    expect(getHigherTaxon(name, path)).toEqual(expected)
  })
})
