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

// A record for the stored key (of a key-only subject unless `subject` says
// otherwise), or for a confident match that named a `matchRank` (a species
// unless said otherwise).
const taxon = (
  via: 'stored-key' | 'match',
  value: unknown,
  matchRank: unknown = 'SPECIES',
  subject: Record<string, unknown> = {}
) => ({
  kind: 'taxon',
  via,
  ...(via === 'match'
    ? { matchRank }
    : {
        scientificName: null,
        name: null,
        nameConfirmed: false,
        category: null,
        kingdom: null,
        ...subject
      }),
  taxon: value,
  storedKeyUnknown: false
})

// A common-name search that could confirm its one exact hit.
const search = (value: unknown, overrides: Record<string, unknown> = {}) => ({
  kind: 'search',
  complete: true,
  exhaustive: true,
  exactHits: 1,
  kingdom: 'Animalia',
  taxon: value,
  storedKeyUnknown: false,
  ...overrides
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
  describe('a stored key checked against the subject', () => {
    const stored = (value: unknown, subject: Record<string, unknown>) =>
      taxon('stored-key', value, undefined, subject)

    it.each([
      ['the canonical name', { scientificName: 'Alcedo atthis' }],
      [
        'the full scientific name',
        { scientificName: 'Alcedo atthis (Linnaeus, 1758)' }
      ],
      ['the name in another case', { scientificName: 'alcedo  ATTHIS' }],
      [
        'the scientific name, with a renamed common name',
        { scientificName: 'Alcedo atthis', name: 'Kawasemi' }
      ],
      [
        'a confirmed common name',
        { name: 'Common Kingfisher', nameConfirmed: true }
      ],
      [
        'the category and its kingdom',
        {
          scientificName: 'Alcedo atthis',
          category: 'bird',
          kingdom: 'Animalia'
        }
      ],
      [
        'a category that names no kingdom',
        { scientificName: 'Alcedo atthis', category: 'other' }
      ]
    ])('resolves a record that agrees with %s', (_label, subject) => {
      expect(
        decideSubjectLookup(
          stored(
            {
              ...KINGFISHER,
              fullScientificName: 'Alcedo atthis (Linnaeus, 1758)'
            },
            subject
          )
        )
      ).toMatchObject({
        subjectLookupStatus: 'resolved',
        subjectIucnCategory: 'LC'
      })
    })

    it.each([
      [
        'another scientific name',
        { scientificName: 'Panthera tigris', name: 'Common Kingfisher' }
      ],
      ['an unconfirmed common name', { name: 'Panda', nameConfirmed: false }],
      [
        'a common name confirmed as not a string',
        { name: 'Panda', nameConfirmed: 'true' }
      ],
      [
        'another kingdom',
        {
          scientificName: 'Alcedo atthis',
          category: 'plant',
          kingdom: 'Plantae'
        }
      ],
      [
        'another category in the same kingdom',
        {
          name: 'Vaquita',
          nameConfirmed: true,
          category: 'mammal',
          kingdom: 'Animalia'
        }
      ],
      ['a kingdom with no names', { category: 'fungus', kingdom: 'Fungi' }],
      ['an unreadable category', { category: 7 }],
      ['an unreadable kingdom', { kingdom: 42 }],
      ['an unreadable scientific name', { scientificName: 7 }],
      ['an empty name', { name: ' ', nameConfirmed: true }],
      ['names missing from the evidence', { scientificName: undefined }]
    ])('fails a record that disagrees: %s', (_label, subject) => {
      expect(decideSubjectLookup(stored(KINGFISHER, subject))).toEqual({
        subjectLookupStatus: 'failed'
      })
    })

    it('fails a key whose record is another species, even an LC one', () => {
      // "Panda" (a mammal) stored with the key of the tree Panda oleosa.
      const decision = decideSubjectLookup(
        stored(
          {
            ...KINGFISHER,
            taxonKey: '5380987',
            scientificName: 'Panda oleosa',
            taxonPath: ['Plantae', 'Tracheophyta'],
            category: 'plant'
          },
          { name: 'Panda', category: 'mammal', kingdom: 'Animalia' }
        )
      )
      expect(decision).toEqual({ subjectLookupStatus: 'failed' })
      expect(isPublic(decision)).toBe(false)
    })
  })

  describe('a taxon record', () => {
    it.each(['stored-key', 'match'] as const)(
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

    it.each(['SUBSPECIES', 'VARIETY', 'species'])(
      'resolves rank %s with its category',
      (rank) => {
        expect(
          decideSubjectLookup(taxon('stored-key', { ...KINGFISHER, rank }))
        ).toMatchObject({
          subjectLookupStatus: 'resolved',
          subjectIucnCategory: 'LC'
        })
      }
    )

    // GBIF never assesses a genus: Pongo reads NE while every one of its
    // species is CR. Kept for the owner, but it never clears the place.
    it.each([
      ['stored-key', 'GENUS'],
      ['match', 'GENUS'],
      ['stored-key', 'FAMILY'],
      ['match', 'FAMILY']
    ] as const)(
      'resolves a %s %s with its key and path but no category',
      (via, rank) => {
        const decision = decideSubjectLookup(
          taxon(
            via,
            { ...TIGER, taxonKey: '5219531', rank, iucnCategory: 'NE' },
            rank
          )
        )
        expect(decision).toEqual({
          subjectLookupStatus: 'resolved',
          subjectTaxonKey: '5219531',
          subjectTaxonPath: TIGER.taxonPath,
          subjectIucnCategory: null
        })
        expect(isPublic(decision)).toBe(false)
      }
    )

    it('stores no category when the match named a genus, whatever the record says', () => {
      const decision = decideSubjectLookup(taxon('match', TIGER, 'GENUS'))
      expect(decision).toMatchObject({
        subjectLookupStatus: 'resolved',
        subjectTaxonKey: TIGER.taxonKey,
        subjectIucnCategory: null
      })
      expect(isPublic(decision)).toBe(false)
    })

    it('stores no category for a genus record the match called a species', () => {
      expect(
        decideSubjectLookup(taxon('match', { ...KINGFISHER, rank: 'GENUS' }))
      ).toMatchObject({ subjectIucnCategory: null })
    })

    it('reads the match rank case-insensitively', () => {
      expect(
        decideSubjectLookup(taxon('match', KINGFISHER, 'subspecies'))
      ).toMatchObject({ subjectIucnCategory: 'LC' })
    })

    it('resolves a taxon found after a stored key GBIF stopped knowing', () => {
      expect(
        decideSubjectLookup({
          ...taxon('match', KINGFISHER),
          storedKeyUnknown: true
        })
      ).toMatchObject({ subjectLookupStatus: 'resolved' })
    })

    it.each([
      ['GBIF does not know the stored key', taxon('stored-key', null)],
      ['GBIF does not know the key its match named', taxon('match', null)],
      ['a search hit as a taxon', taxon('search' as never, KINGFISHER)],
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
      ['a string', taxon('match', 'Alcedo atthis')],
      [
        'no match rank',
        (({ matchRank: _, ...rest }) => rest)(
          taxon('match', KINGFISHER) as Record<string, unknown>
        )
      ],
      ['a match rank above a family', taxon('match', KINGFISHER, 'ORDER')],
      ['a match rank that is not a string', taxon('match', KINGFISHER, 7)],
      [
        'no stored-key flag',
        (({ storedKeyUnknown: _, ...rest }) => rest)(taxon('match', KINGFISHER))
      ]
    ])('records failed for %s', (_, evidence) => {
      expect(decideSubjectLookup(evidence)).toEqual({
        subjectLookupStatus: 'failed'
      })
    })
  })

  // GBIF's NONE: a typo and a species GBIF files under another name cannot
  // be told apart, so it never clears a place.
  it.each([
    ['without a kingdom hint', { hinted: false, storedKeyUnknown: false }],
    ['with a kingdom hint', { hinted: true, storedKeyUnknown: false }],
    ['with no hint flag', { storedKeyUnknown: false }],
    [
      'after a stored key GBIF no longer knows',
      { hinted: false, storedKeyUnknown: true }
    ]
  ])('records failed for a NONE answer %s', (_, fields) => {
    const decision = decideSubjectLookup({ kind: 'match-none', ...fields })
    expect(decision).toEqual({ subjectLookupStatus: 'failed' })
    expect(isPublic(decision)).toBe(false)
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

    it.each([
      ['LC', 'LC'],
      ['NT', 'NT'],
      ['DD', 'DD'],
      ['NE', 'NE'],
      [null, 'NE']
    ] as const)(
      'is resolved with no key or path for a species at %s',
      (category, stored) => {
        const decision = decideSubjectLookup(
          uncertain({ ...KINGFISHER, iucnCategory: category })
        )
        expect(decision).toEqual({
          subjectLookupStatus: 'resolved',
          subjectTaxonPath: null,
          subjectIucnCategory: stored
        })
        expect(isPublic(decision)).toBe(true)
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

  describe('a common-name search', () => {
    it('resolves the one exact hit of a complete, exhaustive search', () => {
      const decision = decideSubjectLookup(search(KINGFISHER))
      expect(decision).toEqual({
        subjectLookupStatus: 'resolved',
        subjectTaxonKey: '2475532',
        subjectTaxonPath: KINGFISHER.taxonPath,
        subjectIucnCategory: 'LC'
      })
      expect(isPublic(decision)).toBe(true)
    })

    it('keeps a threatened hit’s place hidden', () => {
      const decision = decideSubjectLookup(search(TIGER))
      expect(decision).toMatchObject({ subjectIucnCategory: 'EN' })
      expect(isPublic(decision)).toBe(false)
    })

    it('resolves after a stored key GBIF stopped knowing', () => {
      expect(
        decideSubjectLookup(search(KINGFISHER, { storedKeyUnknown: true }))
      ).toMatchObject({ subjectLookupStatus: 'resolved' })
    })

    it.each([
      // "Tiger": 1556 results, and Panthera tigris is not on the first page.
      ['the page is not the last', search(null, { exhaustive: false })],
      [
        'the page is not the last, even with a hit',
        search(KINGFISHER, { exhaustive: false })
      ],
      ['exhaustiveness is unknown', search(KINGFISHER, { exhaustive: 1 })],
      ['some results were unreadable', search(KINGFISHER, { complete: false })],
      ['completeness is unknown', search(KINGFISHER, { complete: undefined })],
      ['nothing names it exactly', search(null, { exactHits: 0 })],
      // "Pangolin" names seven Manis species, some CR.
      ['several results name it exactly', search(KINGFISHER, { exactHits: 2 })],
      ['the hit count is unreadable', search(KINGFISHER, { exactHits: '1' })],
      // "Panda" filed as a mammal: the only hit is the tree Panda oleosa.
      [
        'the hit is in another kingdom',
        search({
          ...KINGFISHER,
          taxonPath: ['Plantae', 'Tracheophyta', 'Magnoliopsida']
        })
      ],
      [
        'the hit has no kingdom',
        search({ ...KINGFISHER, taxonPath: ['Chordata', 'Aves'] })
      ],
      ['the category names no kingdom', search(KINGFISHER, { kingdom: null })],
      ['the kingdom is blank', search(KINGFISHER, { kingdom: '' })],
      ['the hit is a genus', search({ ...KINGFISHER, rank: 'GENUS' })],
      ['the hit is a family', search({ ...KINGFISHER, rank: 'FAMILY' })],
      ['GBIF does not know the key its search named', search(null)],
      [
        'the hit’s category is unreadable',
        search({ ...KINGFISHER, iucnCategory: 'ZZ' })
      ],
      [
        'no stored-key flag',
        (({ storedKeyUnknown: _, ...rest }) => rest)(search(KINGFISHER))
      ],
      [
        'an older search-no-exact answer',
        { kind: 'search-no-exact', complete: true, storedKeyUnknown: false }
      ]
    ])('records failed when %s', (_, evidence) => {
      const decision = decideSubjectLookup(evidence)
      expect(decision).toEqual({ subjectLookupStatus: 'failed' })
      expect(isPublic(decision)).toBe(false)
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
            taxonPath: pick([
              ['Animalia'],
              ['Plantae'],
              ['Chordata'],
              [],
              [1],
              'Animalia',
              undefined
            ]),
            iucnCategory: pick(CATEGORIES),
            scientificName: 'Panthera tigris'
          }
    // One field of an allow-listed answer, drawn from the odd values.
    const FIELD_VALUES: Record<string, () => unknown> = {
      kind: () => pick(['taxon', 'search', 'match-uncertain', 'match-none']),
      via: () => pick(['stored-key', 'match', 'search', undefined]),
      matchRank: () => pick(['SPECIES', 'GENUS', 'ORDER', undefined]),
      taxon: randomTaxon,
      species: randomTaxon,
      speciesKey: () => pick(['5707420', null, 5707420]),
      hinted: () => pick([false, true, undefined]),
      complete: () => pick([true, false, undefined]),
      exhaustive: () => pick([true, false, 1, undefined]),
      exactHits: () => pick([1, 0, 2, '1']),
      kingdom: () => pick(['Animalia', 'Plantae', null]),
      storedKeyUnknown: () => pick([false, true, undefined])
    }
    const SPECIES_TAXON = {
      taxonKey: '5219416',
      rank: 'SPECIES',
      taxonPath: ['Animalia'],
      iucnCategory: 'LC',
      scientificName: 'Panthera tigris'
    }
    const ALLOWED_BASES = [
      taxon('stored-key', SPECIES_TAXON),
      taxon('match', SPECIES_TAXON),
      search(SPECIES_TAXON),
      {
        kind: 'match-uncertain',
        hinted: false,
        speciesKey: '5707420',
        species: SPECIES_TAXON,
        storedKeyUnknown: false
      }
    ]
    // An allow-listed answer with one or two fields changed: the edges of
    // the allow-list, where a wrong check would show.
    const nearlyAllowed = (): unknown => {
      const evidence: Record<string, unknown> = { ...pick(ALLOWED_BASES) }
      const fields = Object.keys(FIELD_VALUES)
      for (let count = random() < 0.5 ? 1 : 2; count > 0; count -= 1) {
        const field = pick(fields)
        evidence[field] = FIELD_VALUES[field]()
      }
      return evidence
    }

    const randomEvidence = (): unknown => {
      if (random() < 0.05) return pick(ODD)
      if (random() < 0.4) return nearlyAllowed()
      return {
        kind: pick([
          'taxon',
          'match-none',
          'match-uncertain',
          'match-unplaced',
          'search',
          'search-no-exact',
          'nothing-to-ask',
          'other',
          undefined
        ]),
        via: maybe(pick(['stored-key', 'match', 'search', 'guess'])),
        matchRank: maybe(pick(RANKS)),
        taxon: randomTaxon(),
        species: randomTaxon(),
        speciesKey: maybe(pick(['5707420', null, 5707420, 'x'])),
        hinted: maybe(pick([false, true, 0, 'false', null])),
        complete: maybe(pick([true, false, 1, 'true', null])),
        exhaustive: maybe(pick([true, false, 1, 'true', null])),
        exactHits: maybe(pick([1, 0, 2, 7, '1', null, 1.5])),
        kingdom: maybe(pick(['Animalia', 'Plantae', null, '', 1])),
        storedKeyUnknown: maybe(pick([false, true, 0, null]))
      }
    }

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

    // The allow-list, restated from the spec of decideSubjectLookup: one
    // species-rank taxon whose category was read and is not CR, EN or VU.
    const onAllowList = (evidence: unknown): boolean => {
      if (!evidence || typeof evidence !== 'object') return false
      const e = evidence as Record<string, unknown>
      if (typeof e.storedKeyUnknown !== 'boolean') return false
      const notThreatened = (value: unknown) =>
        !['CR', 'EN', 'VU'].includes(categoryOf(value))
      if (e.kind === 'taxon') {
        const matchNamedSpecies =
          e.via === 'stored-key' ||
          (e.via === 'match' &&
            typeof e.matchRank === 'string' &&
            SPECIES_RANK_OK.has(e.matchRank.toUpperCase()))
        return (
          matchNamedSpecies &&
          readable(e.taxon, SPECIES_RANK_OK) &&
          notThreatened(e.taxon)
        )
      }
      if (e.kind === 'search') {
        return (
          e.complete === true &&
          e.exhaustive === true &&
          e.exactHits === 1 &&
          typeof e.kingdom === 'string' &&
          e.kingdom !== '' &&
          readable(e.taxon, SPECIES_RANK_OK) &&
          (e.taxon as { taxonPath: string[] }).taxonPath[0] === e.kingdom &&
          notThreatened(e.taxon)
        )
      }
      if (e.storedKeyUnknown !== false) return false
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
        // Never a status outside the two the decision may write: never
        // `no-match`.
        expect(['resolved', 'failed']).toContain(decision.subjectLookupStatus)
      }
      // The generator does reach the allow-list, so the check is not vacuous.
      expect(publicCount).toBeGreaterThan(20)
    })
  })
})
