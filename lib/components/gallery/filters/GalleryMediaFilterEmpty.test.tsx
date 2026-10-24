/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { GalleryMediaFacetsResponse } from '@/lib/services/gallery/galleryEntities'
import { GALLERY_FILTER_NONE } from '@/lib/types/database/gallery'

import { GalleryMediaFilterEmpty } from './GalleryMediaFilterEmpty'
import {
  EMPTY_GALLERY_FILTERS,
  type GalleryMediaFilterState
} from './galleryMediaFilterState'

const sampleFacets: GalleryMediaFacetsResponse = {
  total: 20,
  noPlaceCount: 2,
  notFromActivityCount: 16,
  species: [
    {
      key: 'sci:alcedo atthis',
      name: 'Common kingfisher',
      scientificName: 'Alcedo atthis',
      category: 'bird',
      count: 5
    }
  ],
  places: [
    {
      name: 'Lake Bled, Slovenia',
      count: 12
    }
  ],
  months: [
    {
      month: '2024-05',
      count: 8
    }
  ],
  activities: [
    {
      id: 'act-123',
      activityType: 'Ride',
      startTime: '2024-05-18T10:00:00Z',
      distanceMeters: 45000,
      placeName: 'Slovenia',
      count: 4
    }
  ]
}

describe('GalleryMediaFilterEmpty', () => {
  it('renders title "No photos match these filters"', () => {
    const filters: GalleryMediaFilterState = {
      ...EMPTY_GALLERY_FILTERS,
      place: 'Lake Bled, Slovenia',
      order: ['place']
    }

    render(
      <GalleryMediaFilterEmpty
        filters={filters}
        facets={sampleFacets}
        onChange={vi.fn()}
      />
    )

    expect(
      screen.getByText('No photos match these filters')
    ).toBeInTheDocument()
  })

  it('renders description with active values in order joined by " · "', () => {
    const filters: GalleryMediaFilterState = {
      ...EMPTY_GALLERY_FILTERS,
      species: 'sci:alcedo atthis',
      place: 'Lake Bled, Slovenia',
      date: { kind: 'year', year: 2024 },
      order: ['species', 'place', 'date']
    }

    render(
      <GalleryMediaFilterEmpty
        filters={filters}
        facets={sampleFacets}
        onChange={vi.fn()}
      />
    )

    expect(
      screen.getByText('Common kingfisher · Lake Bled, Slovenia · 2024')
    ).toBeInTheDocument()
  })

  it('"Remove <last>" button removes only the last-added filter', () => {
    const onChange = vi.fn()
    const filters: GalleryMediaFilterState = {
      ...EMPTY_GALLERY_FILTERS,
      species: 'sci:alcedo atthis',
      place: 'Lake Bled, Slovenia',
      date: { kind: 'year', year: 2024 },
      order: ['species', 'place', 'date']
    }

    render(
      <GalleryMediaFilterEmpty
        filters={filters}
        facets={sampleFacets}
        onChange={onChange}
      />
    )

    const removeButton = screen.getByRole('button', { name: 'Remove 2024' })
    expect(removeButton).toBeInTheDocument()

    fireEvent.click(removeButton)

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({
      ...filters,
      date: null,
      order: ['species', 'place']
    })
  })

  it('removes notInAlbum filter correctly when it is the last-added filter', () => {
    const onChange = vi.fn()
    const filters: GalleryMediaFilterState = {
      ...EMPTY_GALLERY_FILTERS,
      place: GALLERY_FILTER_NONE,
      notInAlbum: true,
      order: ['place', 'notInAlbum']
    }

    render(
      <GalleryMediaFilterEmpty
        filters={filters}
        facets={sampleFacets}
        onChange={onChange}
      />
    )

    const removeButton = screen.getByRole('button', {
      name: 'Remove Not in an album'
    })
    expect(removeButton).toBeInTheDocument()

    fireEvent.click(removeButton)

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({
      ...filters,
      notInAlbum: false,
      order: ['place']
    })
  })

  it('"Clear filters" button calls onChange with cleared filters', () => {
    const onChange = vi.fn()
    const filters: GalleryMediaFilterState = {
      ...EMPTY_GALLERY_FILTERS,
      species: 'sci:alcedo atthis',
      place: 'Lake Bled, Slovenia',
      date: { kind: 'year', year: 2024 },
      sort: 'taken_asc',
      order: ['species', 'place', 'date']
    }

    render(
      <GalleryMediaFilterEmpty
        filters={filters}
        facets={sampleFacets}
        onChange={onChange}
      />
    )

    const clearButton = screen.getByRole('button', { name: 'Clear filters' })
    expect(clearButton).toBeInTheDocument()

    fireEvent.click(clearButton)

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({
      ...EMPTY_GALLERY_FILTERS,
      sort: 'taken_asc'
    })
  })

  it('when filters.order is empty, "Remove" button is not shown, only "Clear filters"', () => {
    const onChange = vi.fn()
    const filters: GalleryMediaFilterState = {
      ...EMPTY_GALLERY_FILTERS,
      order: []
    }

    render(
      <GalleryMediaFilterEmpty
        filters={filters}
        facets={sampleFacets}
        onChange={onChange}
      />
    )

    expect(
      screen.queryByRole('button', { name: /^Remove / })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Clear filters' })
    ).toBeInTheDocument()
  })

  it('handles null facets gracefully when formatting active values', () => {
    const onChange = vi.fn()
    const filters: GalleryMediaFilterState = {
      ...EMPTY_GALLERY_FILTERS,
      species: 'sci:alcedo atthis',
      place: 'Lake Bled, Slovenia',
      order: ['species', 'place']
    }

    render(
      <GalleryMediaFilterEmpty
        filters={filters}
        facets={null}
        onChange={onChange}
      />
    )

    expect(
      screen.getByText('alcedo atthis · Lake Bled, Slovenia')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Remove Lake Bled, Slovenia' })
    ).toBeInTheDocument()
  })

  it('applies custom className to the container', () => {
    const { container } = render(
      <GalleryMediaFilterEmpty
        filters={EMPTY_GALLERY_FILTERS}
        facets={null}
        onChange={vi.fn()}
        className="custom-empty-class"
      />
    )

    expect(container.firstChild).toHaveClass('custom-empty-class')
  })
})
