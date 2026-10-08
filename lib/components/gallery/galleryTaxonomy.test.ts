import { describe, expect, it } from 'vitest'

import {
  formatCountryCount,
  formatCountryNames,
  formatGalleryMapSummary,
  formatTaxonPath,
  getCountryName,
  getGbifSpeciesHref,
  getHashtagHref,
  toScientificHashtag
} from '@/lib/components/gallery/galleryTaxonomy'

describe('galleryTaxonomy', () => {
  it.each([
    ['TH', 'Thailand'],
    ['CR', 'Costa Rica'],
    ['ZZ', null],
    ['th', null],
    ['', null],
    [null, null]
  ])('names %s as %s', (code, expected) => {
    expect(getCountryName(code)).toBe(expected)
  })

  it('lists up to three countries then counts the rest', () => {
    expect(formatCountryNames(['CR'])).toBe('Costa Rica')
    expect(formatCountryNames(['CR', 'TH', 'KE', 'JP', 'DE'])).toBe(
      'Costa Rica, Thailand, Kenya +2'
    )
    expect(formatCountryNames(['ZZ'])).toBeNull()
    expect(formatCountryNames([])).toBeNull()
  })

  it('pluralises the country count', () => {
    expect(formatCountryCount(1)).toBe('1 country')
    expect(formatCountryCount(7)).toBe('7 countries')
  })

  it('joins the taxon path', () => {
    expect(formatTaxonPath(['Animalia', 'Chordata', 'Aves'])).toBe(
      'Animalia › Chordata › Aves'
    )
    expect(formatTaxonPath([])).toBeNull()
    expect(formatTaxonPath(null)).toBeNull()
  })

  it.each([
    ['2481017', 'https://www.gbif.org/species/2481017'],
    ['abc', null],
    ['1/../2', null],
    [null, null]
  ])('links GBIF key %s', (key, href) => {
    expect(getGbifSpeciesHref(key)).toBe(href)
  })

  it.each([
    ['Alcedo atthis', 'AlcedoAtthis'],
    ['Ramphastos sulfuratus', 'RamphastosSulfuratus'],
    ['Alcedo atthis bengalensis', 'AlcedoAtthis'],
    ['alcedo ATTHIS', 'AlcedoAtthis'],
    ['Alcedo', null],
    ['', null],
    [null, null]
  ])('tags %s as %s', (name, tag) => {
    expect(toScientificHashtag(name)).toBe(tag)
  })

  it('builds a hashtag href', () => {
    expect(getHashtagHref('AlcedoAtthis')).toBe('/tags/AlcedoAtthis')
  })
})

describe('formatGalleryMapSummary', () => {
  it.each([
    [1008, 7, '1,008 photos and videos with a place · 7 countries'],
    [1, 1, '1 photo or video with a place · 1 country'],
    [5, null, '5 photos and videos with a place'],
    [5, 0, '5 photos and videos with a place'],
    [5, undefined, '5 photos and videos with a place']
  ])('summarises %s photos in %s countries', (count, countries, text) => {
    expect(formatGalleryMapSummary(count, countries)).toBe(text)
  })
})
