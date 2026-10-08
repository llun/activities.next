import iucnEndangered from './__fixtures__/gbif-iucn-en.json'
import iucnLeastConcern from './__fixtures__/gbif-iucn-lc.json'
import matchExact from './__fixtures__/gbif-match-exact.json'
import matchFuzzy from './__fixtures__/gbif-match-fuzzy.json'
import matchGenus from './__fixtures__/gbif-match-genus.json'
import matchNone from './__fixtures__/gbif-match-none.json'
import matchSynonym from './__fixtures__/gbif-match-synonym.json'
import searchKingfisher from './__fixtures__/gbif-search-kingfisher.json'
import taxonKingfisher from './__fixtures__/gbif-taxon-kingfisher.json'
import {
  getTaxonCategory,
  isReadableMatch,
  normalizeIucnCategory,
  normalizeMatch,
  normalizeTaxonRecord
} from './normalizeTaxon'

describe('normalizeMatch', () => {
  it('accepts an exact species match from a recorded answer', () => {
    expect(normalizeMatch(matchExact)).toEqual({
      taxonKey: '2475532',
      scientificName: 'Alcedo atthis',
      rank: 'SPECIES',
      taxonPath: [
        'Animalia',
        'Chordata',
        'Aves',
        'Coraciiformes',
        'Alcedinidae'
      ],
      category: 'bird',
      synonym: false
    })
  })

  it('accepts a fuzzy match at or above 90', () => {
    expect(matchFuzzy.matchType).toBe('FUZZY')
    expect(normalizeMatch(matchFuzzy)?.taxonKey).toBe('2475532')
  })

  it('reports a synonym under the accepted key', () => {
    expect(normalizeMatch(matchSynonym)).toMatchObject({
      taxonKey: '2487879',
      synonym: true
    })
  })

  it('rejects a genus unless a group pick allows it', () => {
    expect(normalizeMatch(matchGenus)).toBeNull()
    expect(normalizeMatch(matchGenus, { allowHigherRank: true })).toMatchObject(
      { taxonKey: '2475493', rank: 'GENUS', synonym: false }
    )
  })

  it('rejects a match that found nothing', () => {
    expect(normalizeMatch(matchNone)).toBeNull()
  })

  it.each([
    ['low confidence', { ...matchExact, confidence: 89 }],
    ['a higher-rank match', { ...matchExact, matchType: 'HIGHERRANK' }],
    ['no match type', { ...matchExact, matchType: undefined }],
    ['an order', { ...matchExact, rank: 'ORDER' }],
    ['no key', { ...matchExact, usageKey: undefined }],
    ['no name', { ...matchExact, canonicalName: '', scientificName: '' }],
    ['a string confidence', { ...matchExact, confidence: '99' }]
  ])('rejects %s', (_label, raw) => {
    expect(normalizeMatch(raw)).toBeNull()
  })

  it.each([
    [{ ...matchExact, rank: 'SUBSPECIES' }, 'SUBSPECIES'],
    [{ ...matchExact, rank: 'VARIETY' }, 'VARIETY']
  ])('accepts ranks below species', (raw, rank) => {
    expect(normalizeMatch(raw)?.rank).toBe(rank)
  })

  it.each([null, undefined, 'x', 3])('rejects %j', (raw) => {
    expect(normalizeMatch(raw)).toBeNull()
  })
})

describe('normalizeTaxonRecord', () => {
  it('reads a recorded species/{key} answer', () => {
    expect(normalizeTaxonRecord(taxonKingfisher)).toEqual({
      taxonKey: '2475532',
      scientificName: 'Alcedo atthis',
      rank: 'SPECIES',
      taxonPath: [
        'Animalia',
        'Chordata',
        'Aves',
        'Coraciiformes',
        'Alcedinidae'
      ],
      category: 'bird'
    })
  })

  it('reads recorded search results, preferring the backbone key', () => {
    const [first, , third] = searchKingfisher.results.map(normalizeTaxonRecord)
    expect(first?.taxonKey).toBe('2475532')
    expect(third).toMatchObject({ category: 'other', taxonKey: '11166877' })
  })

  it('normalizes the upper case names of other checklists', () => {
    expect(
      normalizeTaxonRecord({
        key: 5,
        nubKey: 9,
        canonicalName: 'Alcedo atthis',
        rank: 'SPECIES',
        kingdom: 'ANIMALIA',
        phylum: 'CHORDATA',
        class: 'Aves'
      })
    ).toMatchObject({
      taxonKey: '9',
      taxonPath: ['Animalia', 'Chordata', 'Aves']
    })
  })

  it.each([
    ['no key', { canonicalName: 'x', rank: 'SPECIES' }],
    ['no name', { key: 1, rank: 'SPECIES' }],
    ['no rank', { key: 1, canonicalName: 'x' }],
    ['a bad key', { key: 'abc', canonicalName: 'x', rank: 'SPECIES' }]
  ])('rejects %s', (_label, raw) => {
    expect(normalizeTaxonRecord(raw)).toBeNull()
  })
})

describe('getTaxonCategory', () => {
  it.each([
    [{ kingdom: 'Animalia', class: 'Aves' }, 'bird'],
    [{ kingdom: 'Animalia', class: 'Mammalia' }, 'mammal'],
    [{ kingdom: 'Animalia', class: 'Reptilia' }, 'reptile'],
    [{ kingdom: 'Animalia', order: 'Squamata' }, 'reptile'],
    [{ kingdom: 'Animalia', order: 'Testudines' }, 'reptile'],
    [{ kingdom: 'Animalia', order: 'Crocodylia' }, 'reptile'],
    [{ kingdom: 'Animalia', class: 'Amphibia' }, 'amphibian'],
    [{ kingdom: 'Animalia', class: 'Actinopterygii' }, 'fish'],
    [{ kingdom: 'Animalia', class: 'Chondrichthyes' }, 'fish'],
    [{ kingdom: 'Animalia', class: 'Sarcopterygii' }, 'fish'],
    [{ kingdom: 'Animalia', class: 'Myxini' }, 'fish'],
    [{ kingdom: 'Animalia', class: 'Petromyzonti' }, 'fish'],
    [{ kingdom: 'Animalia', class: 'Insecta' }, 'insect'],
    [{ kingdom: 'Plantae', class: 'Magnoliopsida' }, 'plant'],
    [{ kingdom: 'PLANTAE' }, 'plant'],
    [{ kingdom: 'Fungi', class: 'Agaricomycetes' }, 'fungus'],
    [{ kingdom: 'Animalia', class: 'Arachnida' }, 'other'],
    [{ kingdom: 'Bacteria' }, 'other'],
    [{}, 'other']
  ])('maps %j to %s', (raw, category) => {
    expect(getTaxonCategory(raw)).toBe(category)
  })
})

describe('normalizeIucnCategory', () => {
  it('reads the code of recorded answers', () => {
    expect(normalizeIucnCategory(iucnLeastConcern)).toBe('LC')
    expect(normalizeIucnCategory(iucnEndangered)).toBe('EN')
  })

  it.each(['CR', 'EN', 'VU', 'NT', 'LC', 'DD', 'NE', 'EW', 'EX'])(
    'accepts %s',
    (code) => {
      expect(normalizeIucnCategory({ code })).toBe(code)
    }
  )

  it.each([
    [{ code: 'LR/lc' }],
    [{ code: '' }],
    [{ category: 'SOMETHING_NEW' }],
    [null],
    ['LC']
  ])('rejects %j', (raw) => {
    expect(normalizeIucnCategory(raw)).toBeNull()
  })

  it.each([
    ['LEAST_CONCERN', 'LC'],
    ['ENDANGERED', 'EN'],
    ['CRITICALLY_ENDANGERED', 'CR'],
    ['Vulnerable', 'VU'],
    ['NOT_EVALUATED', 'NE']
  ])('falls back to the category name %s', (category, code) => {
    expect(normalizeIucnCategory({ category })).toBe(code)
  })

  it('prefers the code to the category name', () => {
    expect(normalizeIucnCategory({ code: 'VU', category: 'ENDANGERED' })).toBe(
      'VU'
    )
  })
})

describe('isReadableMatch', () => {
  it('reads recorded answers, including no match', () => {
    expect(isReadableMatch(matchExact)).toBe(true)
    expect(isReadableMatch(matchNone)).toBe(true)
    expect(isReadableMatch(matchGenus)).toBe(true)
  })

  it.each([
    [null],
    ['EXACT'],
    [{ result: { matchType: 'EXACT' } }],
    [{ matchType: 'EXACT', confidence: 99, rank: 'SPECIES' }],
    [{ matchType: 'EXACT', usageKey: 1, canonicalName: 'A b', rank: 'SPECIES' }]
  ])('does not read %j', (raw) => {
    expect(isReadableMatch(raw)).toBe(false)
  })
})
