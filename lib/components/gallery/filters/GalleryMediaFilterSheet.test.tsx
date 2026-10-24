/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { GalleryMediaFacetsResponse } from '@/lib/services/gallery/galleryEntities'
import { GALLERY_FILTER_NONE } from '@/lib/types/database/gallery'

import { GalleryMediaFilterSheet } from './GalleryMediaFilterSheet'
import {
  EMPTY_GALLERY_FILTERS,
  type GalleryMediaFilterState
} from './galleryMediaFilterState'

describe('GalleryMediaFilterSheet', () => {
  const sampleFacets: GalleryMediaFacetsResponse = {
    total: 100,
    species: [
      {
        key: 'name:Red Fox',
        name: 'Red Fox',
        scientificName: 'Vulpes vulpes',
        category: 'mammal',
        count: 12
      },
      {
        key: 'sci:panthera-leo',
        name: null,
        scientificName: 'Panthera leo',
        category: 'mammal',
        count: 7
      }
    ],
    places: [
      { name: 'Richmond Park', count: 25 },
      { name: 'Box Hill', count: 18 }
    ],
    noPlaceCount: 5,
    months: [
      { month: '2025-10', count: 30 },
      { month: '2025-09', count: 20 },
      { month: '2024-12', count: 10 }
    ],
    activities: [
      {
        id: 'act-1',
        activityType: 'run',
        startTime: '2025-10-15T08:00:00Z',
        distanceMeters: 5000,
        placeName: 'Richmond Park',
        count: 14
      }
    ],
    notFromActivityCount: 15
  }

  it('does not render sheet content when open is false', () => {
    render(
      <GalleryMediaFilterSheet
        open={false}
        onOpenChange={vi.fn()}
        filters={EMPTY_GALLERY_FILTERS}
        facets={sampleFacets}
        onApply={vi.fn()}
      />
    )

    expect(screen.queryByText('Filters')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders header "Clear all", "Filters", and "Show N" when open is true', () => {
    render(
      <GalleryMediaFilterSheet
        open={true}
        onOpenChange={vi.fn()}
        filters={EMPTY_GALLERY_FILTERS}
        facets={sampleFacets}
        onApply={vi.fn()}
      />
    )

    expect(
      screen.getByRole('button', { name: 'Clear all' })
    ).toBeInTheDocument()
    expect(screen.getByText('Filters')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show 100' })).toBeInTheDocument()
  })

  it('displays rows for Species, Place, Date taken, and Activity with default "Any" labels', () => {
    render(
      <GalleryMediaFilterSheet
        open={true}
        onOpenChange={vi.fn()}
        filters={EMPTY_GALLERY_FILTERS}
        facets={sampleFacets}
        onApply={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: /Species/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Place/ })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Date taken/ })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Activity/ })).toBeInTheDocument()

    // Right-side default labels
    const anyLabels = screen.getAllByText('Any')
    expect(anyLabels).toHaveLength(4)
  })

  it('displays formatted active filter values in rows', () => {
    const activeFilters: GalleryMediaFilterState = {
      species: 'name:Red Fox',
      place: 'Richmond Park',
      date: { kind: 'this_month' },
      activity: 'act-1',
      notInAlbum: false,
      sort: 'taken_desc',
      order: ['species', 'place', 'date', 'activity']
    }

    render(
      <GalleryMediaFilterSheet
        open={true}
        onOpenChange={vi.fn()}
        filters={activeFilters}
        facets={sampleFacets}
        onApply={vi.fn()}
      />
    )

    expect(screen.getByText('Red Fox')).toBeInTheDocument()
    expect(screen.getByText('Richmond Park')).toBeInTheDocument()
    expect(screen.getByText('This month')).toBeInTheDocument()
    expect(screen.getByText(/Run|Running/)).toBeInTheDocument()
  })

  it('displays "Not in an album" row when showNotInAlbumToggle is true and hides it when false', () => {
    const { rerender } = render(
      <GalleryMediaFilterSheet
        open={true}
        onOpenChange={vi.fn()}
        filters={EMPTY_GALLERY_FILTERS}
        facets={sampleFacets}
        showNotInAlbumToggle={true}
        onApply={vi.fn()}
      />
    )

    expect(screen.getByLabelText('Not in an album')).toBeInTheDocument()
    expect(
      screen.getByRole('switch', { name: 'Not in an album' })
    ).toBeInTheDocument()

    rerender(
      <GalleryMediaFilterSheet
        open={true}
        onOpenChange={vi.fn()}
        filters={EMPTY_GALLERY_FILTERS}
        facets={sampleFacets}
        showNotInAlbumToggle={false}
        onApply={vi.fn()}
      />
    )

    expect(screen.queryByLabelText('Not in an album')).not.toBeInTheDocument()
  })

  it('drills down into Place subview, allows selecting a place or "No place", updates draft, and navigates back', () => {
    const onApply = vi.fn()
    render(
      <GalleryMediaFilterSheet
        open={true}
        onOpenChange={vi.fn()}
        filters={EMPTY_GALLERY_FILTERS}
        facets={sampleFacets}
        onApply={onApply}
      />
    )

    // Click Place row to open Place subview
    fireEvent.click(screen.getByRole('button', { name: /Place/ }))

    expect(screen.getByRole('heading', { name: 'Place' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Back to filters' })
    ).toBeInTheDocument()
    expect(screen.getByText('Any place')).toBeInTheDocument()
    expect(screen.getByText('Richmond Park')).toBeInTheDocument()
    expect(screen.getByText('No place')).toBeInTheDocument()

    // Select Richmond Park
    fireEvent.click(screen.getByRole('button', { name: /Richmond Park/ }))

    // Back to main view

    expect(screen.getByText('Filters')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Place Richmond Park/ })
    ).toBeInTheDocument()

    // Drill down again and choose "No place"
    fireEvent.click(screen.getByRole('button', { name: /Place/ }))
    fireEvent.click(screen.getByRole('button', { name: /No place/ }))

    expect(
      screen.getByRole('button', { name: /Place No place/ })
    ).toBeInTheDocument()

    // Apply and verify GALLERY_FILTER_NONE is passed
    fireEvent.click(screen.getByRole('button', { name: /Show/ }))
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        place: GALLERY_FILTER_NONE,
        order: ['place']
      })
    )
  })

  it('drills down into Species subview and allows selecting species or Any', () => {
    render(
      <GalleryMediaFilterSheet
        open={true}
        onOpenChange={vi.fn()}
        filters={EMPTY_GALLERY_FILTERS}
        facets={sampleFacets}
        onApply={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Species/ }))

    expect(screen.getByRole('heading', { name: 'Species' })).toBeInTheDocument()
    expect(screen.getByText('Red Fox')).toBeInTheDocument()

    // Select Red Fox
    fireEvent.click(screen.getByRole('button', { name: /Red Fox/ }))

    expect(
      screen.getByRole('button', { name: /Species Red Fox/ })
    ).toBeInTheDocument()
  })

  it('drills down into Activity subview and allows selecting activity or "Not from an activity"', () => {
    render(
      <GalleryMediaFilterSheet
        open={true}
        onOpenChange={vi.fn()}
        filters={EMPTY_GALLERY_FILTERS}
        facets={sampleFacets}
        onApply={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Activity/ }))

    expect(
      screen.getByRole('heading', { name: 'Activity' })
    ).toBeInTheDocument()
    expect(screen.getByText('Not from an activity')).toBeInTheDocument()

    // Select Not from an activity
    fireEvent.click(
      screen.getByRole('button', { name: /Not from an activity/ })
    )

    expect(
      screen.getByRole('button', { name: /Activity Not from an activity/ })
    ).toBeInTheDocument()
  })

  it('drills down into Date subview and allows selecting date presets', () => {
    render(
      <GalleryMediaFilterSheet
        open={true}
        onOpenChange={vi.fn()}
        filters={EMPTY_GALLERY_FILTERS}
        facets={sampleFacets}
        onApply={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Date taken/ }))

    expect(
      screen.getByRole('heading', { name: 'Date taken' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /This month/ })
    ).toBeInTheDocument()

    // Select This month
    fireEvent.click(screen.getByRole('button', { name: /This month/ }))

    expect(
      screen.getByRole('button', { name: /Date taken This month/ })
    ).toBeInTheDocument()
  })

  it('toggles "Not in an album" switch and passes it when applied', () => {
    const onApply = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <GalleryMediaFilterSheet
        open={true}
        onOpenChange={onOpenChange}
        filters={EMPTY_GALLERY_FILTERS}
        facets={sampleFacets}
        showNotInAlbumToggle={true}
        onApply={onApply}
      />
    )

    const toggle = screen.getByRole('switch', { name: 'Not in an album' })
    expect(toggle).toHaveAttribute('data-state', 'unchecked')

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('data-state', 'checked')

    // Apply
    fireEvent.click(screen.getByRole('button', { name: /Show/ }))

    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        notInAlbum: true,
        order: ['notInAlbum']
      })
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('calls countDraft when draft changes, updates "Show N" count, and drops stale answers', async () => {
    let resolveFirst!: (val: number) => void
    let resolveSecond!: (val: number) => void

    const countDraft = vi
      .fn()
      // Initial count call
      .mockResolvedValueOnce(50)
      // When Richmond Park selected
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve
          })
      )
      // When Box Hill selected
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve
          })
      )

    render(
      <GalleryMediaFilterSheet
        open={true}
        onOpenChange={vi.fn()}
        filters={EMPTY_GALLERY_FILTERS}
        facets={sampleFacets}
        countDraft={countDraft}
        onApply={vi.fn()}
      />
    )

    // Initial count resolves to 50
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Show 50' })
      ).toBeInTheDocument()
    })

    // Drill down to place and select Richmond Park (triggers request 2)
    fireEvent.click(screen.getByRole('button', { name: /Place/ }))
    fireEvent.click(screen.getByRole('button', { name: /Richmond Park/ }))

    // Picking returns to the rows; open Place again and pick Box Hill (request 3)
    fireEvent.click(screen.getByRole('button', { name: /Place/ }))
    fireEvent.click(screen.getByRole('button', { name: /Box Hill/ }))

    expect(countDraft).toHaveBeenCalledTimes(3)

    // Resolve second request first with 18
    resolveSecond(18)

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Show 18' })
      ).toBeInTheDocument()
    })

    // Resolve first (stale) request with 999
    resolveFirst(999)

    // Stale answer should be dropped; count stays 18
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Show 18' })
      ).toBeInTheDocument()
    })
    expect(
      screen.queryByRole('button', { name: 'Show 999' })
    ).not.toBeInTheDocument()
  })

  it('shows "Show" without a number, enabled, when counting fails', async () => {
    const countDraft = vi
      .fn()
      .mockResolvedValueOnce(50)
      .mockRejectedValueOnce(new Error('boom'))
    render(
      <GalleryMediaFilterSheet
        open={true}
        onOpenChange={vi.fn()}
        filters={EMPTY_GALLERY_FILTERS}
        facets={sampleFacets}
        countDraft={countDraft}
        onApply={vi.fn()}
      />
    )
    await screen.findByRole('button', { name: 'Show 50' })

    fireEvent.click(screen.getByRole('button', { name: /Place/ }))
    fireEvent.click(screen.getByRole('button', { name: /Richmond Park/ }))

    const show = await screen.findByRole('button', { name: 'Show' })
    expect(show).toBeEnabled()
    expect(
      screen.queryByRole('button', { name: 'Show 50' })
    ).not.toBeInTheDocument()
  })

  it('keeps "Show" enabled while the count never settles, and applies', () => {
    const onApply = vi.fn()
    render(
      <GalleryMediaFilterSheet
        open={true}
        onOpenChange={vi.fn()}
        filters={EMPTY_GALLERY_FILTERS}
        facets={sampleFacets}
        countDraft={() => new Promise<number>(() => {})}
        onApply={onApply}
      />
    )
    const show = screen.getByRole('button', { name: 'Show' })
    expect(show).toBeEnabled()
    fireEvent.click(show)
    expect(onApply).toHaveBeenCalledWith(EMPTY_GALLERY_FILTERS)
  })

  it('disables the facet rows while facets are loading', () => {
    render(
      <GalleryMediaFilterSheet
        open={true}
        onOpenChange={vi.fn()}
        filters={EMPTY_GALLERY_FILTERS}
        facets={null}
        onApply={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: /Place/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Show' })).toBeEnabled()
  })

  it('"Clear all" button resets draft filters while keeping sort', () => {
    const onApply = vi.fn()
    const activeFilters: GalleryMediaFilterState = {
      species: 'name:Red Fox',
      place: 'Richmond Park',
      date: { kind: 'this_month' },
      activity: 'act-1',
      notInAlbum: true,
      sort: 'uploaded',
      order: ['species', 'place', 'date', 'activity', 'notInAlbum']
    }

    render(
      <GalleryMediaFilterSheet
        open={true}
        onOpenChange={vi.fn()}
        filters={activeFilters}
        facets={sampleFacets}
        showNotInAlbumToggle={true}
        onApply={onApply}
      />
    )

    expect(screen.getByText('Red Fox')).toBeInTheDocument()
    expect(screen.getByText('Richmond Park')).toBeInTheDocument()

    // Click Clear all
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))

    // All rows reset to Any
    const anyLabels = screen.getAllByText('Any')
    expect(anyLabels).toHaveLength(4)

    // Switch unchecked
    const toggle = screen.getByRole('switch', { name: 'Not in an album' })
    expect(toggle).toHaveAttribute('data-state', 'unchecked')

    // Click Show to apply cleared draft
    fireEvent.click(screen.getByRole('button', { name: /Show/ }))

    expect(onApply).toHaveBeenCalledWith({
      species: null,
      place: null,
      date: null,
      activity: null,
      notInAlbum: false,
      sort: 'uploaded',
      order: []
    })
  })

  it('"Show N" button calls onApply(draft) with current draft and closes the sheet', () => {
    const onApply = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <GalleryMediaFilterSheet
        open={true}
        onOpenChange={onOpenChange}
        filters={EMPTY_GALLERY_FILTERS}
        facets={sampleFacets}
        onApply={onApply}
      />
    )

    // Select a place
    fireEvent.click(screen.getByRole('button', { name: /Place/ }))
    fireEvent.click(screen.getByRole('button', { name: /Richmond Park/ }))

    // Click Show button directly from subview
    fireEvent.click(screen.getByRole('button', { name: /Show/ }))

    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        place: 'Richmond Park',
        order: ['place']
      })
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('reinitializes draft from filters when open transitions from false to true', () => {
    const initialFilters: GalleryMediaFilterState = {
      ...EMPTY_GALLERY_FILTERS,
      place: 'Box Hill',
      order: ['place']
    }

    const { rerender } = render(
      <GalleryMediaFilterSheet
        open={false}
        onOpenChange={vi.fn()}
        filters={initialFilters}
        facets={sampleFacets}
        onApply={vi.fn()}
      />
    )

    expect(screen.queryByText('Filters')).not.toBeInTheDocument()

    rerender(
      <GalleryMediaFilterSheet
        open={true}
        onOpenChange={vi.fn()}
        filters={initialFilters}
        facets={sampleFacets}
        onApply={vi.fn()}
      />
    )

    expect(screen.getByText('Box Hill')).toBeInTheDocument()
  })
})
