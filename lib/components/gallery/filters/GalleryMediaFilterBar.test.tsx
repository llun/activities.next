/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { GalleryMediaFacetsResponse } from '@/lib/services/gallery/galleryEntities'

import { GalleryMediaFilterBar } from './GalleryMediaFilterBar'
import {
  EMPTY_GALLERY_FILTERS,
  type GalleryMediaFilterState
} from './galleryMediaFilterState'

describe('GalleryMediaFilterBar', () => {
  const mockFacets: GalleryMediaFacetsResponse = {
    total: 42,
    species: [
      {
        key: 'name:Red Fox',
        name: 'Red Fox',
        scientificName: 'Vulpes vulpes',
        category: 'mammal',
        count: 10
      },
      {
        key: 'name:Mallard',
        name: 'Mallard',
        scientificName: 'Anas platyrhynchos',
        category: 'bird',
        count: 5
      }
    ],
    places: [
      { name: 'Richmond Park', count: 20 },
      { name: 'Hyde Park', count: 12 }
    ],
    noPlaceCount: 10,
    months: [
      { month: '2025-10', count: 15 },
      { month: '2025-09', count: 12 },
      { month: '2024-05', count: 15 }
    ],
    activities: [
      {
        id: 'act-1',
        activityType: 'run',
        startTime: '2025-10-15T08:00:00Z',
        distanceMeters: 5000,
        placeName: 'Richmond Park',
        count: 12
      }
    ],
    notFromActivityCount: 30
  }

  describe('Render with mock facets, skeleton, and error', () => {
    it('renders both desktop and mobile sections when facets are provided', () => {
      render(
        <GalleryMediaFilterBar
          idPrefix="test"
          filters={EMPTY_GALLERY_FILTERS}
          onChange={vi.fn()}
          facets={mockFacets}
          total={42}
        />
      )

      expect(screen.getByTestId('test-desktop-filters')).toBeInTheDocument()
      expect(screen.getByTestId('test-mobile-filters')).toBeInTheDocument()
      expect(
        screen.queryByRole('status', { name: 'Loading filters' })
      ).not.toBeInTheDocument()
    })

    it('keeps leading, sort and the toggle while facets load, and skeletons only the facet menus', () => {
      render(
        <GalleryMediaFilterBar
          idPrefix="test"
          filters={EMPTY_GALLERY_FILTERS}
          onChange={vi.fn()}
          facets={null}
          total={null}
          showNotInAlbumToggle
          leading={<div data-testid="leading-slot">Leading content</div>}
        />
      )

      expect(
        screen.getByRole('status', { name: 'Loading filters' })
      ).toBeInTheDocument()
      const desktop = screen.getByTestId('test-desktop-filters')
      expect(within(desktop).getByTestId('leading-slot')).toBeInTheDocument()
      expect(
        within(desktop).getByRole('button', { name: 'Not in an album' })
      ).toBeEnabled()
      expect(within(desktop).getByRole('group', { name: 'Sort' })).toBeVisible()
      expect(
        within(desktop).queryByRole('button', { name: /Species:/ })
      ).not.toBeInTheDocument()
      const mobile = screen.getByTestId('test-mobile-filters')
      expect(
        within(mobile).getByRole('button', { name: 'Filters' })
      ).toBeDisabled()
    })

    it('on a facets error never shows a skeleton: disabled menus and a working Try again', () => {
      const onRetryFacets = vi.fn()
      render(
        <GalleryMediaFilterBar
          idPrefix="test"
          filters={EMPTY_GALLERY_FILTERS}
          onChange={vi.fn()}
          facets={null}
          facetsError="Could not load"
          onRetryFacets={onRetryFacets}
          total={null}
        />
      )

      expect(
        screen.queryByRole('status', { name: 'Loading filters' })
      ).not.toBeInTheDocument()
      const desktop = screen.getByTestId('test-desktop-filters')
      expect(
        within(desktop).getByRole('button', { name: 'Species: Any species' })
      ).toBeDisabled()
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
      expect(onRetryFacets).toHaveBeenCalledTimes(1)
    })

    it('renders alert error when facetsError is provided', () => {
      render(
        <GalleryMediaFilterBar
          idPrefix="test"
          filters={EMPTY_GALLERY_FILTERS}
          onChange={vi.fn()}
          facets={mockFacets}
          facetsError="Failed to load facets data"
          total={42}
        />
      )

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Failed to load facets data'
      )
    })
  })

  describe('Desktop filters', () => {
    it('selects Place, sets filter and updates via onChange', () => {
      const onChange = vi.fn()
      render(
        <GalleryMediaFilterBar
          idPrefix="test"
          filters={EMPTY_GALLERY_FILTERS}
          onChange={onChange}
          facets={mockFacets}
          total={42}
        />
      )

      const desktop = screen.getByTestId('test-desktop-filters')
      const placeTrigger = within(desktop).getByRole('button', {
        name: 'Place: Any place'
      })
      fireEvent.click(placeTrigger)

      const option = screen.getByRole('button', { name: /Richmond Park/i })
      fireEvent.click(option)

      expect(onChange).toHaveBeenCalledWith({
        ...EMPTY_GALLERY_FILTERS,
        place: 'Richmond Park',
        order: ['place']
      })
    })

    it('selects "No place" and sets place to "none"', () => {
      const onChange = vi.fn()
      render(
        <GalleryMediaFilterBar
          idPrefix="test"
          filters={EMPTY_GALLERY_FILTERS}
          onChange={onChange}
          facets={mockFacets}
          total={42}
        />
      )

      const desktop = screen.getByTestId('test-desktop-filters')
      const placeTrigger = within(desktop).getByRole('button', {
        name: 'Place: Any place'
      })
      fireEvent.click(placeTrigger)

      const noPlaceOption = screen.getByRole('button', { name: /No place/i })
      fireEvent.click(noPlaceOption)

      expect(onChange).toHaveBeenCalledWith({
        ...EMPTY_GALLERY_FILTERS,
        place: 'none',
        order: ['place']
      })
    })

    it('selects Species and updates filter', () => {
      const onChange = vi.fn()
      render(
        <GalleryMediaFilterBar
          idPrefix="test"
          filters={EMPTY_GALLERY_FILTERS}
          onChange={onChange}
          facets={mockFacets}
          total={42}
        />
      )

      const desktop = screen.getByTestId('test-desktop-filters')
      const speciesTrigger = within(desktop).getByRole('button', {
        name: 'Species: Any species'
      })
      fireEvent.click(speciesTrigger)

      const redFoxOption = screen.getByRole('button', { name: /Red Fox/i })
      fireEvent.click(redFoxOption)

      expect(onChange).toHaveBeenCalledWith({
        ...EMPTY_GALLERY_FILTERS,
        species: 'name:Red Fox',
        order: ['species']
      })
    })

    it('selects Activity and updates filter', () => {
      const onChange = vi.fn()
      render(
        <GalleryMediaFilterBar
          idPrefix="test"
          filters={EMPTY_GALLERY_FILTERS}
          onChange={onChange}
          facets={mockFacets}
          total={42}
        />
      )

      const desktop = screen.getByTestId('test-desktop-filters')
      const activityTrigger = within(desktop).getByRole('button', {
        name: 'Activity: Any activity'
      })
      fireEvent.click(activityTrigger)

      const runOption = screen.getByRole('button', { name: /Run/i })
      fireEvent.click(runOption)

      expect(onChange).toHaveBeenCalledWith({
        ...EMPTY_GALLERY_FILTERS,
        activity: 'act-1',
        order: ['activity']
      })
    })

    it('selects "Not from an activity" and sets activity to "none"', () => {
      const onChange = vi.fn()
      render(
        <GalleryMediaFilterBar
          idPrefix="test"
          filters={EMPTY_GALLERY_FILTERS}
          onChange={onChange}
          facets={mockFacets}
          total={42}
        />
      )

      const desktop = screen.getByTestId('test-desktop-filters')
      const activityTrigger = within(desktop).getByRole('button', {
        name: 'Activity: Any activity'
      })
      fireEvent.click(activityTrigger)

      const noneOption = screen.getByRole('button', {
        name: /Not from an activity/i
      })
      fireEvent.click(noneOption)

      expect(onChange).toHaveBeenCalledWith({
        ...EMPTY_GALLERY_FILTERS,
        activity: 'none',
        order: ['activity']
      })
    })

    it('selects Date presets and custom ranges', () => {
      const onChange = vi.fn()
      const { rerender } = render(
        <GalleryMediaFilterBar
          idPrefix="test"
          filters={EMPTY_GALLERY_FILTERS}
          onChange={onChange}
          facets={mockFacets}
          total={42}
        />
      )

      const desktop = screen.getByTestId('test-desktop-filters')
      const dateTrigger = within(desktop).getByRole('button', {
        name: 'Date taken: Any time'
      })
      fireEvent.click(dateTrigger)

      const thisMonthOption = screen.getByRole('button', {
        name: /This month/i
      })
      fireEvent.click(thisMonthOption)

      expect(onChange).toHaveBeenCalledWith({
        ...EMPTY_GALLERY_FILTERS,
        date: { kind: 'this_month' },
        order: ['date']
      })

      // Test custom range
      rerender(
        <GalleryMediaFilterBar
          idPrefix="test"
          filters={EMPTY_GALLERY_FILTERS}
          onChange={onChange}
          facets={mockFacets}
          total={42}
        />
      )
      const dateTrigger2 = within(
        screen.getByTestId('test-desktop-filters')
      ).getByRole('button', {
        name: 'Date taken: Any time'
      })
      fireEvent.click(dateTrigger2)

      const fromInput = screen.getByLabelText(/From/i)
      const toInput = screen.getByLabelText(/To/i)
      fireEvent.change(fromInput, { target: { value: '2025-01-01' } })
      fireEvent.change(toInput, { target: { value: '2025-01-31' } })

      const applyButton = screen.getByRole('button', { name: 'Apply' })
      fireEvent.click(applyButton)

      expect(onChange).toHaveBeenCalledWith({
        ...EMPTY_GALLERY_FILTERS,
        date: { kind: 'custom', from: '2025-01-01', to: '2025-01-31' },
        order: ['date']
      })
    })

    it('shows active triggers with accent style and dedicated ✕ button that clears filter', () => {
      const onChange = vi.fn()
      const activeState: GalleryMediaFilterState = {
        ...EMPTY_GALLERY_FILTERS,
        species: 'name:Red Fox',
        order: ['species']
      }

      render(
        <GalleryMediaFilterBar
          idPrefix="test"
          filters={activeState}
          onChange={onChange}
          facets={mockFacets}
          total={10}
        />
      )

      const desktop = screen.getByTestId('test-desktop-filters')
      const group = within(desktop).getByRole('group', {
        name: 'Species filter'
      })
      expect(group).toHaveClass('border-primary')
      expect(group).toHaveClass('bg-primary/10')

      const clearButton = within(group).getByRole('button', {
        name: 'Clear Red Fox filter'
      })
      fireEvent.click(clearButton)

      expect(onChange).toHaveBeenCalledWith({
        ...EMPTY_GALLERY_FILTERS,
        species: null,
        order: []
      })
    })

    it('toggles "Not in an album" button state', () => {
      const onChange = vi.fn()
      const { rerender } = render(
        <GalleryMediaFilterBar
          idPrefix="test"
          filters={EMPTY_GALLERY_FILTERS}
          onChange={onChange}
          facets={mockFacets}
          showNotInAlbumToggle={true}
          total={42}
        />
      )

      const desktop = screen.getByTestId('test-desktop-filters')
      const toggle = within(desktop).getByRole('button', {
        name: 'Not in an album'
      })
      expect(toggle).toHaveAttribute('aria-pressed', 'false')

      fireEvent.click(toggle)
      expect(onChange).toHaveBeenCalledWith({
        ...EMPTY_GALLERY_FILTERS,
        notInAlbum: true,
        order: ['notInAlbum']
      })

      // Rerender as active
      rerender(
        <GalleryMediaFilterBar
          idPrefix="test"
          filters={{
            ...EMPTY_GALLERY_FILTERS,
            notInAlbum: true,
            order: ['notInAlbum']
          }}
          onChange={onChange}
          facets={mockFacets}
          showNotInAlbumToggle={true}
          total={42}
        />
      )

      const activeToggle = within(
        screen.getByTestId('test-desktop-filters')
      ).getByRole('button', {
        name: 'Not in an album'
      })
      expect(activeToggle).toHaveAttribute('aria-pressed', 'true')
      expect(activeToggle).toHaveClass('border-primary')

      fireEvent.click(activeToggle)
      expect(onChange).toHaveBeenCalledWith({
        ...EMPTY_GALLERY_FILTERS,
        notInAlbum: false,
        order: []
      })
    })

    it('changes sort using Sort menu', async () => {
      const onChange = vi.fn()
      render(
        <GalleryMediaFilterBar
          idPrefix="test"
          filters={EMPTY_GALLERY_FILTERS}
          onChange={onChange}
          facets={mockFacets}
          total={42}
        />
      )

      const desktop = screen.getByTestId('test-desktop-filters')
      const sortGroup = within(desktop).getByRole('group', { name: 'Sort' })
      const sortButton = sortGroup.querySelector('button')!
      fireEvent.keyDown(sortButton, { key: 'ArrowDown' })

      const oldestOption = await screen.findByRole('menuitemradio', {
        name: /Date taken, oldest first/i
      })
      fireEvent.click(oldestOption)

      expect(onChange).toHaveBeenCalledWith({
        ...EMPTY_GALLERY_FILTERS,
        sort: 'taken_asc'
      })
    })

    it('renders leading slot when provided', () => {
      render(
        <GalleryMediaFilterBar
          idPrefix="test"
          filters={EMPTY_GALLERY_FILTERS}
          onChange={vi.fn()}
          facets={mockFacets}
          leading={<div data-testid="leading-slot">Leading content</div>}
          total={42}
        />
      )

      const desktop = screen.getByTestId('test-desktop-filters')
      expect(within(desktop).getByTestId('leading-slot')).toBeInTheDocument()
      const mobile = screen.getByTestId('test-mobile-filters')
      expect(within(mobile).getByTestId('leading-slot')).toBeInTheDocument()
    })

    it('keeps focus on the same trigger after clearing with the ✕ button', () => {
      render(
        <GalleryMediaFilterBar
          idPrefix="test"
          filters={{
            ...EMPTY_GALLERY_FILTERS,
            species: 'name:Red Fox',
            order: ['species']
          }}
          onChange={vi.fn()}
          facets={mockFacets}
          total={10}
        />
      )
      const desktop = screen.getByTestId('test-desktop-filters')
      const trigger = within(desktop).getByRole('button', {
        name: 'Species: Red Fox'
      })
      fireEvent.click(
        within(desktop).getByRole('button', { name: 'Clear Red Fox filter' })
      )
      expect(document.activeElement).toBe(trigger)
    })

    it('renders the list inside portalContainer so dialogs do not cancel its scrolling', () => {
      const host = document.createElement('div')
      document.body.appendChild(host)
      render(
        <GalleryMediaFilterBar
          idPrefix="test"
          filters={EMPTY_GALLERY_FILTERS}
          onChange={vi.fn()}
          facets={mockFacets}
          total={10}
          portalContainer={host}
        />
      )
      const desktop = screen.getByTestId('test-desktop-filters')
      fireEvent.click(
        within(desktop).getByRole('button', { name: 'Place: Any place' })
      )
      expect(
        within(host).getByRole('button', { name: /Richmond Park/ })
      ).toBeInTheDocument()
      host.remove()
    })
  })

  describe('Mobile filters', () => {
    it('shows "Filters" when no filters are active, and "Filters · N" when active', () => {
      const { rerender } = render(
        <GalleryMediaFilterBar
          idPrefix="test"
          filters={EMPTY_GALLERY_FILTERS}
          onChange={vi.fn()}
          facets={mockFacets}
          total={42}
        />
      )

      const mobile = screen.getByTestId('test-mobile-filters')
      expect(
        within(mobile).getByRole('button', { name: 'Filters' })
      ).toBeInTheDocument()

      rerender(
        <GalleryMediaFilterBar
          idPrefix="test"
          filters={{
            ...EMPTY_GALLERY_FILTERS,
            species: 'name:Red Fox',
            place: 'Richmond Park',
            order: ['species', 'place']
          }}
          onChange={vi.fn()}
          facets={mockFacets}
          total={42}
        />
      )

      const updatedMobile = screen.getByTestId('test-mobile-filters')
      expect(
        within(updatedMobile).getByRole('button', { name: 'Filters · 2' })
      ).toBeInTheDocument()
    })

    it('opens GalleryMediaFilterSheet on clicking "Filters"', async () => {
      render(
        <GalleryMediaFilterBar
          idPrefix="test"
          filters={EMPTY_GALLERY_FILTERS}
          onChange={vi.fn()}
          facets={mockFacets}
          total={42}
        />
      )

      const mobile = screen.getByTestId('test-mobile-filters')
      const filtersButton = within(mobile).getByRole('button', {
        name: 'Filters'
      })
      fireEvent.click(filtersButton)

      expect(
        await screen.findByRole('button', { name: 'Clear all' })
      ).toBeInTheDocument()
    })

    it('renders active chips row with ✕ buttons that remove individual filters', () => {
      const onChange = vi.fn()
      render(
        <GalleryMediaFilterBar
          idPrefix="test"
          filters={{
            ...EMPTY_GALLERY_FILTERS,
            species: 'name:Red Fox',
            place: 'Richmond Park',
            order: ['species', 'place']
          }}
          onChange={onChange}
          facets={mockFacets}
          total={42}
        />
      )

      const mobile = screen.getByTestId('test-mobile-filters')
      expect(within(mobile).getByText('Red Fox')).toBeInTheDocument()
      expect(within(mobile).getByText('Richmond Park')).toBeInTheDocument()

      const clearFoxButton = within(mobile).getByRole('button', {
        name: 'Clear Red Fox filter'
      })
      fireEvent.click(clearFoxButton)

      expect(onChange).toHaveBeenCalledWith({
        ...EMPTY_GALLERY_FILTERS,
        species: null,
        place: 'Richmond Park',
        order: ['place']
      })
    })
  })

  describe('Count line', () => {
    it('shows "19 photos · 4 already in this album" on desktop and "19 photos" on mobile', () => {
      render(
        <GalleryMediaFilterBar
          idPrefix="test"
          filters={EMPTY_GALLERY_FILTERS}
          onChange={vi.fn()}
          facets={mockFacets}
          total={19}
          inAlbumTotal={4}
        />
      )

      const countLine = screen.getByTestId('test-count-line')
      expect(
        within(countLine).getByText('19 photos · 4 already in this album')
      ).toBeInTheDocument()
      expect(within(countLine).getByText('19 photos')).toBeInTheDocument()
    })

    it('shows no photo count when total is null', () => {
      render(
        <GalleryMediaFilterBar
          idPrefix="test"
          filters={EMPTY_GALLERY_FILTERS}
          onChange={vi.fn()}
          facets={mockFacets}
          total={null}
        />
      )

      const countLine = screen.getByTestId('test-count-line')
      expect(countLine).not.toHaveTextContent('photo')
    })

    it('resets filters when "Clear filters" is clicked', () => {
      const onChange = vi.fn()
      render(
        <GalleryMediaFilterBar
          idPrefix="test"
          filters={{
            ...EMPTY_GALLERY_FILTERS,
            species: 'name:Red Fox',
            order: ['species']
          }}
          onChange={onChange}
          facets={mockFacets}
          total={10}
        />
      )

      const countLine = screen.getByTestId('test-count-line')
      expect(within(countLine).getByText('Clear filters')).toBeInTheDocument()
      expect(within(countLine).getByRole('status')).not.toHaveTextContent(
        'Clear'
      )
      expect(within(countLine).getByText('Clear')).toBeInTheDocument()

      const clearButton = within(countLine).getByRole('button', {
        name: /Clear/i
      })
      fireEvent.click(clearButton)

      expect(onChange).toHaveBeenCalledWith(EMPTY_GALLERY_FILTERS)
    })
  })
})
