import { isPlaceWithheldForThreat } from '@/lib/services/gallery/threatenedSpecies'
import { IUCN_CATEGORIES, IucnCategory } from '@/lib/types/database/gallery'

import type { GbifTaxon } from './gbif'
import { decideSubjectLookup } from './subjectDecision'

const TIGER: GbifTaxon = {
  taxonKey: '5219416',
  scientificName: 'Panthera tigris',
  rank: 'SPECIES',
  taxonPath: ['Animalia', 'Chordata', 'Mammalia', 'Carnivora', 'Felidae'],
  category: 'mammal',
  vernacularName: 'Tiger',
  iucnCategory: 'EN'
}
const KINGFISHER: GbifTaxon = {
  taxonKey: '2475532',
  scientificName: 'Alcedo atthis',
  rank: 'SPECIES',
  taxonPath: ['Animalia', 'Chordata', 'Aves', 'Coraciiformes', 'Alcedinidae'],
  category: 'bird',
  vernacularName: 'Common Kingfisher',
  iucnCategory: 'LC'
}

const taxon = (via: 'stored-key' | 'match' | 'search', value: unknown) => ({
  kind: 'taxon',
  via,
  taxon: value,
  storedKeyUnknown: false
})

// Whether a stored decision lets the place be shown, as the place rule reads it.
const isPublic = (decision: ReturnType<typeof decideSubjectLookup>) =>
  !isPlaceWithheldForThreat(
    {
      subjectName: 'x',
      subjectScientificName: 'X y',
      subjectCategory: 'mammal',
      subjectTaxonKey: null,
      subjectIucnCategory: null,
      ...decision
    },
    { hideThreatenedPlaces: true }
  )

describe('decideSubjectLookup', () => {
  describe('a taxon record', () => {
    it.each(['stored-key', 'match', 'search'] as const)(
      'resolves a readable record found by %s, with its key and path',
      (via) => {
        expect(decideSubjectLookup(taxon(via, KINGFISHER))).toEqual({
          subjectLookupStatus: 'resolved',
          subjectTaxonKey: '2475532',
          subjectTaxonPath: KINGFISHER.taxonPath,
          subjectIucnCategory: 'LC'
        })
      }
    )

    it.each(IUCN_CATEGORIES)('stores category %s as read', (category) => {
      expect(
        decideSubjectLookup(
          taxon('match', { ...TIGER, iucnCategory: category })
        )
      ).toMatchObject({
        subjectLookupStatus: 'resolved',
        subjectIucnCategory: category
      })
    })

    it('stores GBIF’s 204 (null) as NE', () => {
      expect(
        decideSubjectLookup(taxon('match', { ...TIGER, iucnCategory: null }))
      ).toMatchObject({ subjectIucnCategory: 'NE' })
    })

    it.each(['SUBSPECIES', 'VARIETY', 'GENUS', 'FAMILY', 'species'])(
      'resolves rank %s',
      (rank) => {
        expect(
          decideSubjectLookup(taxon('stored-key', { ...KINGFISHER, rank }))
            .subjectLookupStatus
        ).toBe('resolved')
      }
    )

    it.each([
      ['GBIF does not know the stored key', taxon('stored-key', null)],
      ['GBIF does not know the key its match named', taxon('match', null)],
      ['GBIF does not know the key its search named', taxon('search', null)],
      ['a kingdom', taxon('match', { ...KINGFISHER, rank: 'KINGDOM' })],
      ['an order', taxon('match', { ...KINGFISHER, rank: 'ORDER' })],
      ['a class', taxon('stored-key', { ...KINGFISHER, rank: 'CLASS' })],
      ['an unknown rank', taxon('match', { ...KINGFISHER, rank: 'CLADE' })],
      ['no rank', taxon('match', { ...KINGFISHER, rank: undefined })],
      ['a bad key', taxon('match', { ...KINGFISHER, taxonKey: 'abc' })],
      ['a numeric key', taxon('match', { ...KINGFISHER, taxonKey: 2475532 })],
      ['no path', taxon('match', { ...KINGFISHER, taxonPath: undefined })],
      ['a bad path', taxon('match', { ...KINGFISHER, taxonPath: [1, 2] })],
      [
        'an unknown category',
        taxon('match', { ...KINGFISHER, iucnCategory: 'ZZ' })
      ],
      [
        'a lower-case category',
        taxon('match', { ...KINGFISHER, iucnCategory: 'lc' })
      ],
      [
        'a missing category',
        taxon('match', { ...KINGFISHER, iucnCategory: undefined })
      ],
      [
        'no category field at all',
        taxon('match', (({ iucnCategory: _, ...rest }) => rest)(KINGFISHER))
      ],
      ['an unknown source', taxon('guess' as never, KINGFISHER)],
      ['a list', taxon('match', [KINGFISHER])],
      ['a string', taxon('match', 'Alcedo atthis')]
    ])('records failed for %s', (_, evidence) => {
      expect(decideSubjectLookup(evidence)).toEqual({
        subjectLookupStatus: 'failed'
      })
    })
  })

  describe('a NONE answer', () => {
    it('is no-match without a kingdom hint', () => {
      const decision = decideSubjectLookup({
        kind: 'match-none',
        hinted: false,
        storedKeyUnknown: false
      })
      expect(decision).toEqual({
        subjectLookupStatus: 'no-match',
        subjectTaxonPath: null,
        subjectIucnCategory: null
      })
      expect(isPublic(decision)).toBe(true)
    })

    it.each([
      ['with a kingdom hint', { hinted: true, storedKeyUnknown: false }],
      ['with no hint flag', { storedKeyUnknown: false }],
      [
        'after a stored key GBIF no longer knows',
        { hinted: false, storedKeyUnknown: true }
      ],
      ['with no stored-key flag', { hinted: false }]
    ])('is failed %s', (_, fields) => {
      expect(decideSubjectLookup({ kind: 'match-none', ...fields })).toEqual({
        subjectLookupStatus: 'failed'
      })
    })
  })

  describe('an uncertain match', () => {
    const uncertain = (species: unknown, overrides = {}) => ({
      kind: 'match-uncertain',
      hinted: false,
      speciesKey: '5707420',
      species,
      storedKeyUnknown: false,
      ...overrides
    })

    it.each(['LC', 'NT', 'DD', 'NE', null] as const)(
      'is no-match for a species at %s',
      (category) => {
        const decision = decideSubjectLookup(
          uncertain({ ...KINGFISHER, iucnCategory: category })
        )
        expect(decision.subjectLookupStatus).toBe('no-match')
      }
    )

    it.each(['CR', 'EN', 'VU'] as const)(
      'is resolved %s with no key or path for a threatened species',
      (category) => {
        const decision = decideSubjectLookup(
          uncertain({ ...TIGER, iucnCategory: category })
        )
        expect(decision).toEqual({
          subjectLookupStatus: 'resolved',
          subjectTaxonPath: null,
          subjectIucnCategory: category
        })
        expect(isPublic(decision)).toBe(false)
      }
    )

    it.each([
      ['an extinct species', uncertain({ ...TIGER, iucnCategory: 'EX' })],
      [
        'a species extinct in the wild',
        uncertain({ ...TIGER, iucnCategory: 'EW' })
      ],
      ['a genus only', uncertain(null, { speciesKey: null })],
      ['an unknown species', uncertain(null)],
      ['a genus record as the species', uncertain({ ...TIGER, rank: 'GENUS' })],
      ['an unreadable category', uncertain({ ...TIGER, iucnCategory: 'ZZ' })],
      ['a hinted answer', uncertain(KINGFISHER, { hinted: true })],
      ['a bad species key', uncertain(KINGFISHER, { speciesKey: 5707420 })],
      [
        'a stored key GBIF no longer knows',
        uncertain(KINGFISHER, { storedKeyUnknown: true })
      ]
    ])('is failed for %s', (_, evidence) => {
      expect(decideSubjectLookup(evidence)).toEqual({
        subjectLookupStatus: 'failed'
      })
    })
  })

  describe('a search with no exact hit', () => {
    it('is no-match when every result was readable', () => {
      expect(
        decideSubjectLookup({
          kind: 'search-no-exact',
          complete: true,
          storedKeyUnknown: false
        }).subjectLookupStatus
      ).toBe('no-match')
    })

    it.each([
      [
        'some results were unreadable',
        { complete: false, storedKeyUnknown: false }
      ],
      ['completeness is unknown', { storedKeyUnknown: false }],
      [
        'a stored key GBIF no longer knows',
        { complete: true, storedKeyUnknown: true }
      ]
    ])('is failed when %s', (_, fields) => {
      expect(
        decideSubjectLookup({ kind: 'search-no-exact', ...fields })
      ).toEqual({ subjectLookupStatus: 'failed' })
    })
  })

  it.each([
    [
      'an unplaced match',
      { kind: 'match-unplaced', hinted: false, storedKeyUnknown: false }
    ],
    ['nothing to ask', { kind: 'nothing-to-ask', storedKeyUnknown: false }],
    ['an unknown kind', { kind: 'match-maybe', storedKeyUnknown: false }],
    ['no kind', { storedKeyUnknown: false }],
    ['null', null],
    ['undefined', undefined],
    ['a string', 'match-none'],
    ['a list', [{ kind: 'match-none', hinted: false, storedKeyUnknown: false }]]
  ])('records failed for %s', (_, evidence) => {
    expect(decideSubjectLookup(evidence)).toEqual({
      subjectLookupStatus: 'failed'
    })
  })

  // Property-style: many odd evidence objects, built from every field value
  // seen above and some never seen. The place may only be public for an
  // answer on the allow-list, checked here independently of the decision.
  describe('never makes a place public off the allow-list', () => {
    let seed = 20261008
    const random = () => {
      // mulberry32: deterministic, so a failure reproduces.
      seed = (seed + 0x6d2b79f5) | 0
      let t = seed
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const pick = <T>(values: readonly T[]): T =>
      values[Math.floor(random() * values.length)]
    const maybe = <T>(value: T) => (random() < 0.15 ? undefined : value)

    const ODD = [undefined, null, '', 0, 1, true, false, [], {}, 'x', NaN]
    const CATEGORIES: unknown[] = [
      ...IUCN_CATEGORIES,
      null,
      'lc',
      'ZZ',
      1,
      undefined
    ]
    const RANKS = [
      'SPECIES',
      'SUBSPECIES',
      'GENUS',
      'FAMILY',
      'ORDER',
      'KINGDOM',
      'species',
      '',
      7
    ]
    const randomTaxon = () =>
      random() < 0.15
        ? pick(ODD)
        : {
            taxonKey: pick(['5219416', '6', 'abc', 5219416, '', undefined]),
            rank: maybe(pick(RANKS)),
            taxonPath: pick([['Animalia'], [], [1], 'Animalia', undefined]),
            iucnCategory: pick(CATEGORIES),
            scientificName: 'Panthera tigris'
          }
    const randomEvidence = (): unknown => {
      if (random() < 0.05) return pick(ODD)
      return {
        kind: pick([
          'taxon',
          'match-none',
          'match-uncertain',
          'match-unplaced',
          'search-no-exact',
          'nothing-to-ask',
          'other',
          undefined
        ]),
        via: maybe(pick(['stored-key', 'match', 'search', 'guess'])),
        taxon: randomTaxon(),
        species: randomTaxon(),
        speciesKey: maybe(pick(['5707420', null, 5707420, 'x'])),
        hinted: maybe(pick([false, true, 0, 'false', null])),
        complete: maybe(pick([true, false, 1, 'true', null])),
        storedKeyUnknown: maybe(pick([false, true, 0, null]))
      }
    }

    const RANK_OK = new Set(['SPECIES', 'SUBSPECIES', 'GENUS', 'FAMILY'])
    const SPECIES_RANK_OK = new Set(['SPECIES', 'SUBSPECIES'])
    const KNOWN = new Set<unknown>(IUCN_CATEGORIES)
    const readable = (value: unknown, ranks: Set<string>) => {
      const record = value as Record<string, unknown> | null
      return (
        !!record &&
        typeof record === 'object' &&
        !Array.isArray(record) &&
        typeof record.taxonKey === 'string' &&
        /^\d+$/.test(record.taxonKey) &&
        typeof record.rank === 'string' &&
        ranks.has(record.rank.toUpperCase()) &&
        Array.isArray(record.taxonPath) &&
        record.taxonPath.every((part) => typeof part === 'string') &&
        'iucnCategory' in record &&
        (record.iucnCategory === null || KNOWN.has(record.iucnCategory))
      )
    }
    const categoryOf = (value: unknown): IucnCategory =>
      ((value as { iucnCategory: IucnCategory | null }).iucnCategory ??
        'NE') as IucnCategory

    // The allow-list, restated from the spec of decideSubjectLookup.
    const onAllowList = (evidence: unknown): boolean => {
      if (!evidence || typeof evidence !== 'object') return false
      const e = evidence as Record<string, unknown>
      if (e.kind === 'taxon') {
        return (
          ['stored-key', 'match', 'search'].includes(e.via as string) &&
          readable(e.taxon, RANK_OK) &&
          !['CR', 'EN', 'VU'].includes(categoryOf(e.taxon))
        )
      }
      if (e.storedKeyUnknown !== false) return false
      if (e.kind === 'match-none') return e.hinted === false
      if (e.kind === 'search-no-exact') return e.complete === true
      if (e.kind === 'match-uncertain') {
        return (
          e.hinted === false &&
          typeof e.speciesKey === 'string' &&
          /^\d+$/.test(e.speciesKey) &&
          readable(e.species, SPECIES_RANK_OK) &&
          ['LC', 'NT', 'DD', 'NE'].includes(categoryOf(e.species))
        )
      }
      return false
    }

    it('holds for 5000 random answers', () => {
      let publicCount = 0
      for (let index = 0; index < 5000; index += 1) {
        const evidence = randomEvidence()
        const decision = decideSubjectLookup(evidence)
        if (isPublic(decision)) {
          publicCount += 1
          expect({ evidence, allowed: onAllowList(evidence) }).toEqual({
            evidence,
            allowed: true
          })
        }
        // Never a status outside the three the decision may write.
        expect(['resolved', 'no-match', 'failed']).toContain(
          decision.subjectLookupStatus
        )
      }
      // The generator does reach the allow-list, so the check is not vacuous.
      expect(publicCount).toBeGreaterThan(20)
    })
  })
})
