import { buildSuggestion } from '@/lib/components/gallery/__fixtures__/galleryAlbumSuggestions'

import {
  getSuggestedAlbumsLabel,
  getSuggestionMeta
} from './galleryAlbumSuggestionsUi'

describe('getSuggestionMeta', () => {
  it('describes a trip with its dates, places and species', () => {
    expect(
      getSuggestionMeta(
        buildSuggestion('t', {
          photoCount: 86,
          placeCount: 4,
          speciesCount: 11
        })
      )
    ).toBe('Trip · 86 photos · 12 – 19 Sep 2026 · 4 places · 11 species')
  })

  it('leaves out places and species a trip does not have', () => {
    expect(
      getSuggestionMeta(
        buildSuggestion('t', { photoCount: 1, placeCount: 0, speciesCount: 0 })
      )
    ).toBe('Trip · 1 photo · 12 – 19 Sep 2026')
    expect(
      getSuggestionMeta(
        buildSuggestion('t', { placeCount: 1, speciesCount: 1 })
      )
    ).toBe('Trip · 3 photos · 12 – 19 Sep 2026 · 1 place · 1 species')
  })

  it('names a species series by kind and dates only', () => {
    expect(
      getSuggestionMeta(
        buildSuggestion('s', {
          kind: 'species',
          photoCount: 23,
          firstAt: '2024-03-01T10:00:00.000Z',
          lastAt: '2026-05-01T10:00:00.000Z'
        })
      )
    ).toBe('Species · 23 photos · 1 Mar 2024 – 1 May 2026')
  })

  it('says how many recorded activities an activity day matches', () => {
    const day = {
      kind: 'activity_day' as const,
      photoCount: 9,
      firstAt: '2026-09-27T08:00:00.000Z',
      lastAt: '2026-09-27T11:00:00.000Z',
      placeCount: 0,
      speciesCount: 0
    }
    expect(
      getSuggestionMeta(buildSuggestion('a', { ...day, activityCount: 1 }))
    ).toBe(
      'Activity day · 9 photos · 27 Sep 2026 · matches a recorded activity'
    )
    expect(
      getSuggestionMeta(buildSuggestion('a', { ...day, activityCount: 2 }))
    ).toBe(
      'Activity day · 9 photos · 27 Sep 2026 · matches 2 recorded activities'
    )
  })

  it('copes with a suggestion that carries no dates', () => {
    expect(
      getSuggestionMeta(
        buildSuggestion('t', { firstAt: null, lastAt: null, placeCount: 0 })
      )
    ).toBe('Trip · 3 photos · 3 species')
  })
})

describe('getSuggestedAlbumsLabel', () => {
  it('pluralizes', () => {
    expect(getSuggestedAlbumsLabel(1)).toBe('1 suggested album')
    expect(getSuggestedAlbumsLabel(2)).toBe('2 suggested albums')
    expect(getSuggestedAlbumsLabel(1200)).toBe('1,200 suggested albums')
  })
})
