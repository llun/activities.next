import { requestVisionCompletion } from '@/lib/services/altText/openai'
import type { GbifClient } from '@/lib/services/gallery/lookups/gbif'

import {
  SubjectSuggestionError,
  parseSubjectSuggestions,
  suggestSubjects
} from './suggestSubjects'

vi.mock('@/lib/services/altText/openai', () => ({
  requestVisionCompletion: vi.fn()
}))

const CONFIG = { endpoint: 'https://alt.test/v1', apiKey: 'key', model: 'v1' }
const IMAGE = { buffer: Buffer.from('bytes'), mimeType: 'image/jpeg' }
const NOW = new Date('2026-10-08T10:00:00.000Z')

const answer = (value: unknown) =>
  vi
    .mocked(requestVisionCompletion)
    .mockResolvedValue(
      typeof value === 'string' ? value : JSON.stringify(value)
    )

const subject = (overrides: Record<string, unknown> = {}) => ({
  name: 'Warbling White-eye',
  scientificName: 'Zosterops japonicus',
  category: 'bird',
  confidence: 0.81,
  ...overrides
})

describe('parseSubjectSuggestions', () => {
  it('reads plain JSON', () => {
    expect(
      parseSubjectSuggestions(
        JSON.stringify({ subjects: [subject()], group: 'bird' })
      )
    ).toEqual({
      candidates: [
        {
          name: 'Warbling White-eye',
          scientificName: 'Zosterops japonicus',
          category: 'bird',
          confidence: 0.81,
          taxonKey: null,
          rank: null,
          taxonPath: []
        }
      ],
      group: 'bird'
    })
  })

  it.each([
    ['a code fence', '```json\n{"subjects":[],"group":"bird"}\n```'],
    ['chatter around it', 'Sure! {"subjects":[],"group":"bird"} Hope it helps']
  ])('finds the object inside %s', (_, text) => {
    expect(parseSubjectSuggestions(text)).toEqual({
      candidates: [],
      group: 'bird'
    })
  })

  it.each([
    ['no JSON', 'I cannot tell what this is'],
    ['broken JSON', '{"subjects": ['],
    ['an array', '[{"name":"x"}]'],
    ['an empty string', '']
  ])('returns null for %s', (_, text) => {
    expect(parseSubjectSuggestions(text)).toBeNull()
  })

  it('drops a candidate that fails validation and keeps the rest', () => {
    const parsed = parseSubjectSuggestions(
      JSON.stringify({
        subjects: [
          subject({ name: 'x'.repeat(256) }),
          subject({ name: '   ' }),
          subject({ name: 'Eagle', confidence: 'high' }),
          subject({ name: 'Kingfisher', scientificName: 'y'.repeat(256) }),
          subject({ name: 'Heron', scientificName: '' })
        ],
        group: null
      })
    )
    expect(parsed?.candidates.map((candidate) => candidate.name)).toEqual([
      'Heron'
    ])
    expect(parsed?.candidates[0].scientificName).toBeNull()
  })

  it.each([
    ['Bird', 'bird'],
    [' MAMMAL ', 'mammal'],
    ['dinosaur', 'other'],
    [7, 'other'],
    [undefined, 'other']
  ])('coerces the category %j to %s', (category, expected) => {
    const parsed = parseSubjectSuggestions(
      JSON.stringify({ subjects: [subject({ category })], group: null })
    )
    expect(parsed?.candidates[0].category).toBe(expected)
  })

  it.each([
    [1.7, 1],
    [-0.4, 0],
    [81, 0.81],
    [150, 1],
    [0.5, 0.5]
  ])('clamps the confidence %d to %d', (confidence, expected) => {
    const parsed = parseSubjectSuggestions(
      JSON.stringify({ subjects: [subject({ confidence })], group: null })
    )
    expect(parsed?.candidates[0].confidence).toBeCloseTo(expected)
  })

  it('orders by confidence, drops repeated names and keeps three', () => {
    const parsed = parseSubjectSuggestions(
      JSON.stringify({
        subjects: [
          subject({ name: 'A', confidence: 0.1 }),
          subject({ name: 'B', confidence: 0.9 }),
          subject({ name: 'b', confidence: 0.95 }),
          subject({ name: 'C', confidence: 0.5 }),
          subject({ name: 'D', confidence: 0.3 })
        ],
        group: 'bird'
      })
    )
    expect(parsed?.candidates.map((candidate) => candidate.name)).toEqual([
      'B',
      'C',
      'D'
    ])
  })

  it('reads an unknown group as none', () => {
    expect(
      parseSubjectSuggestions('{"subjects":[],"group":"dinosaur"}')?.group
    ).toBeNull()
  })

  it('treats a non-array subjects value as no candidates', () => {
    expect(
      parseSubjectSuggestions('{"subjects":"bird","group":"bird"}')
    ).toEqual({ candidates: [], group: 'bird' })
  })
})

describe('suggestSubjects', () => {
  const matchTaxon = vi.fn()
  const searchTaxa = vi.fn()
  const gbif: Pick<GbifClient, 'matchTaxon' | 'searchTaxa'> = {
    matchTaxon,
    searchTaxa
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const run = (client: typeof gbif | null = gbif) =>
    suggestSubjects({
      config: CONFIG,
      image: IMAGE,
      gbif: client,
      now: () => NOW
    })

  it('asks the vision model with the owner image and a bounded answer', async () => {
    answer({ subjects: [subject()], group: 'bird' })

    await run(null)

    expect(requestVisionCompletion).toHaveBeenCalledWith(
      CONFIG,
      IMAGE.buffer,
      'image/jpeg',
      expect.objectContaining({
        systemPrompt: expect.stringContaining('JSON'),
        maxTokens: 400
      })
    )
  })

  it('returns unchecked candidates when GBIF is off', async () => {
    answer({ subjects: [subject()], group: 'bird' })

    const suggestions = await run(null)

    expect(suggestions).toEqual({
      model: 'v1',
      generatedAt: NOW.toISOString(),
      checkedAgainst: null,
      candidates: [
        expect.objectContaining({
          name: 'Warbling White-eye',
          taxonKey: null,
          taxonPath: []
        })
      ],
      group: 'bird'
    })
  })

  it('adds the taxon GBIF matched for a scientific name, keeping the common name', async () => {
    answer({ subjects: [subject()], group: 'bird' })
    matchTaxon.mockResolvedValue({
      taxonKey: '5232437',
      scientificName: 'Zosterops japonicus',
      rank: 'SPECIES',
      taxonPath: ['Animalia', 'Chordata', 'Aves', 'x'.repeat(80)],
      category: 'bird'
    })

    const suggestions = await run()

    expect(matchTaxon).toHaveBeenCalledWith('Zosterops japonicus', {
      kingdom: 'Animalia'
    })
    expect(suggestions.checkedAgainst).toBe('gbif')
    expect(suggestions.candidates[0]).toEqual({
      name: 'Warbling White-eye',
      scientificName: 'Zosterops japonicus',
      category: 'bird',
      confidence: 0.81,
      taxonKey: '5232437',
      rank: 'SPECIES',
      taxonPath: ['Animalia', 'Chordata', 'Aves', 'x'.repeat(64)]
    })
  })

  it('uses a plant kingdom hint and GBIF’s category when it knows one', async () => {
    answer({
      subjects: [
        subject({ name: 'Fig', scientificName: 'Ficus', category: 'other' })
      ],
      group: 'plant'
    })
    matchTaxon.mockResolvedValue({
      taxonKey: '1',
      scientificName: 'Ficus',
      rank: 'GENUS',
      taxonPath: ['Plantae'],
      category: 'plant'
    })

    const suggestions = await run()

    expect(matchTaxon).toHaveBeenCalledWith('Ficus', { kingdom: undefined })
    expect(suggestions.candidates[0].category).toBe('plant')
  })

  it('searches by common name when there is no scientific name and takes only an exact name match', async () => {
    answer({
      subjects: [subject({ scientificName: null })],
      group: 'bird'
    })
    searchTaxa.mockResolvedValue([
      {
        taxonKey: '9',
        scientificName: 'Zosterops simplex',
        vernacularName: 'Swinhoe’s White-eye',
        vernacularNames: ['Swinhoe’s White-eye'],
        rank: 'SPECIES',
        taxonPath: [],
        category: 'bird'
      },
      {
        taxonKey: '5232437',
        scientificName: 'Zosterops japonicus',
        vernacularName: 'Japanese White-eye',
        vernacularNames: ['Japanese White-eye', 'warbling white-eye'],
        rank: 'SPECIES',
        taxonPath: ['Animalia'],
        category: 'bird'
      }
    ])

    const suggestions = await run()

    expect(searchTaxa).toHaveBeenCalledWith('Warbling White-eye')
    expect(suggestions.candidates[0]).toMatchObject({
      scientificName: 'Zosterops japonicus',
      taxonKey: '5232437'
    })
  })

  it('leaves a candidate alone when GBIF has no match, and never checks scenery', async () => {
    answer({
      subjects: [
        subject({ confidence: 0.9 }),
        subject({
          name: 'Misty hills',
          scientificName: null,
          category: 'landscape',
          confidence: 0.5
        })
      ],
      group: 'landscape'
    })
    matchTaxon.mockResolvedValue(null)

    const suggestions = await run()

    expect(matchTaxon).toHaveBeenCalledTimes(1)
    expect(searchTaxa).not.toHaveBeenCalled()
    expect(suggestions.checkedAgainst).toBe('gbif')
    expect(suggestions.candidates.map((c) => c.taxonKey)).toEqual([null, null])
  })

  it('falls back to the model’s own names, unchecked, when GBIF fails', async () => {
    answer({ subjects: [subject()], group: 'bird' })
    matchTaxon.mockRejectedValue(new Error('GBIF down'))

    const suggestions = await run()

    expect(suggestions.checkedAgainst).toBeNull()
    expect(suggestions.candidates[0]).toMatchObject({
      scientificName: 'Zosterops japonicus',
      taxonKey: null,
      taxonPath: []
    })
  })

  it('does not call GBIF when there is nothing to check', async () => {
    answer({ subjects: [], group: 'landscape' })

    const suggestions = await run()

    expect(matchTaxon).not.toHaveBeenCalled()
    expect(suggestions).toMatchObject({
      checkedAgainst: null,
      candidates: [],
      group: 'landscape'
    })
  })

  it.each([
    [
      'the request fails',
      () =>
        vi.mocked(requestVisionCompletion).mockRejectedValue(new Error('503'))
    ],
    [
      'the model answers nothing',
      () => vi.mocked(requestVisionCompletion).mockResolvedValue(null)
    ],
    ['the answer is junk', () => answer('no idea')]
  ])('throws a SubjectSuggestionError when %s', async (_, arrange) => {
    arrange()

    await expect(run()).rejects.toBeInstanceOf(SubjectSuggestionError)
  })
})
