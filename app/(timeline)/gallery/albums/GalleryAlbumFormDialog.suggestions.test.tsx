/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'

import { GalleryAlbumFormDialog } from '@/app/(timeline)/gallery/albums/GalleryAlbumFormDialog'
import type { GalleryAlbumSuggestionsState } from '@/app/(timeline)/gallery/albums/useGalleryAlbumSuggestions'
import {
  addGalleryAlbumItems,
  createGalleryAlbum,
  updateGalleryAlbum
} from '@/lib/client'
import { buildSuggestion } from '@/lib/components/gallery/__fixtures__/galleryAlbumSuggestions'
import { buildAlbumCard } from '@/lib/components/gallery/__fixtures__/galleryAlbums'
import { buildGalleryItem } from '@/lib/components/gallery/__fixtures__/galleryItems'
import type { GalleryAlbumSuggestionEntity } from '@/lib/services/gallery/galleryAlbumSuggestionEntities'

vi.mock('@/lib/client', () => ({
  addGalleryAlbumItems: vi.fn(),
  createGalleryAlbum: vi.fn(),
  updateGalleryAlbum: vi.fn()
}))

vi.mock('@/lib/client/galleryAlbums', () => ({
  GALLERY_ALBUM_ITEMS_BATCH: 100
}))

// The picker and the review grid have their own tests: here they only show
// what they were given and report picks.
vi.mock('@/app/(timeline)/gallery/albums/GalleryAlbumPicker', () => ({
  GalleryAlbumPicker: ({ selected }: { selected: string[] }) => (
    <span data-testid="picker">{selected.join(',')}</span>
  )
}))

// How many times the review grid has been mounted: the dialog keys it so that
// its filters start afresh.
const reviewMounts = vi.hoisted(() => ({ count: 0 }))

vi.mock('@/app/(timeline)/gallery/albums/GalleryAlbumSuggestionReview', () => ({
  GalleryAlbumSuggestionReview: ({
    suggestion,
    selected,
    onChange,
    onItemsLoaded
  }: {
    suggestion: { id: string; mediaIds: string[] }
    selected: string[]
    onChange: (ids: string[]) => void
    onItemsLoaded?: (items: unknown[]) => void
  }) => {
    const [mount] = useState(() => (reviewMounts.count += 1))
    return (
      <div data-testid="review">
        <span data-testid="review-mount">{mount}</span>
        <span data-testid="review-of">{suggestion.id}</span>
        <span data-testid="review-selected">{selected.join(',')}</span>
        <button type="button" onClick={() => onChange(selected.slice(1))}>
          untick first
        </button>
        <button
          type="button"
          onClick={() =>
            onItemsLoaded?.([
              buildGalleryItem(suggestion.mediaIds[1], {
                attachment: {
                  ...buildGalleryItem(suggestion.mediaIds[1]).attachment,
                  name: 'Second photo'
                }
              })
            ])
          }
        >
          report photos
        </button>
      </div>
    )
  }
}))

const create = vi.mocked(createGalleryAlbum)
const add = vi.mocked(addGalleryAlbumItems)
const update = vi.mocked(updateGalleryAlbum)

const result = (id: string) =>
  ({ added: [], existing: [], skipped: [], album: buildAlbumCard(id) }) as never

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const trip = buildSuggestion('trip:2026-09-12', {
  title: 'Kruger, September 2026',
  photoCount: 3
})
const species = buildSuggestion('species:sci:alcedo atthis', {
  kind: 'species',
  title: 'Common kingfisher',
  photoCount: 3,
  mediaIds: ['k1', 'k2', 'k3']
})

const ready = (
  ...suggestions: GalleryAlbumSuggestionEntity[]
): GalleryAlbumSuggestionsState => ({ status: 'ready', suggestions })

const selectTab = (name: string) =>
  fireEvent.mouseDown(screen.getByRole('tab', { name }), {
    button: 0,
    ctrlKey: false
  })

describe('GalleryAlbumFormDialog suggestions', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    create.mockReset()
    add.mockReset()
    update.mockReset()
  })

  const renderDialog = (
    props: Partial<Parameters<typeof GalleryAlbumFormDialog>[0]> = {}
  ) => {
    const onSaved = vi.fn()
    const reload = vi.fn()
    render(
      <GalleryAlbumFormDialog
        open
        ownerId="owner"
        intent="create"
        suggestions={{ state: ready(trip, species), reload }}
        onOpenChange={vi.fn()}
        onSaved={onSaved}
        {...props}
      />
    )
    return { onSaved, reload }
  }

  it('offers From gallery and Suggestions tabs when creating, From gallery first', () => {
    renderDialog()

    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'From gallery',
      'Suggestions'
    ])
    expect(screen.getByRole('tab', { name: 'From gallery' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    // 40px to touch.
    for (const tab of tabs) expect(tab).toHaveClass('pointer-coarse:min-h-10')
    expect(
      screen.getByText(/replaces the photos you have selected/)
    ).toBeInTheDocument()
  })

  it('hides the panel of the tab that is not open, keeping it mounted', () => {
    renderDialog()

    const panels = document.querySelectorAll('[data-slot="tabs-content"]')
    expect(panels).toHaveLength(2)
    // `forceMount` keeps Radix from setting `hidden`, so a class does it.
    expect(panels[0]).toHaveAttribute('data-state', 'active')
    expect(panels[1]).toHaveAttribute('data-state', 'inactive')
    expect(panels[1]).toHaveClass('data-[state=inactive]:hidden')

    selectTab('Suggestions')
    expect(panels[0]).toHaveAttribute('data-state', 'inactive')
    expect(panels[0]).toHaveClass('data-[state=inactive]:hidden')
    expect(panels[1]).toHaveAttribute('data-state', 'active')
  })

  it('has no tabs without suggestions, nor when editing or adding', () => {
    const { unmount } = render(
      <GalleryAlbumFormDialog
        open
        ownerId="owner"
        intent="create"
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />
    )
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    unmount()

    for (const intent of ['edit', 'add'] as const) {
      const view = render(
        <GalleryAlbumFormDialog
          open
          ownerId="owner"
          intent={intent}
          album={buildAlbumCard('a')}
          suggestions={{ state: ready(trip), reload: vi.fn() }}
          onOpenChange={vi.fn()}
          onSaved={vi.fn()}
        />
      )
      expect(screen.queryByRole('tab')).not.toBeInTheDocument()
      view.unmount()
    }
  })

  it('opens on the Suggestions tab when asked to', () => {
    renderDialog({ initialTab: 'suggestions' })

    expect(screen.getByRole('tab', { name: 'Suggestions' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(
      screen.getByRole('list', { name: 'Suggested albums' })
    ).toBeInTheDocument()
  })

  it('selects the photos and fills the title, saving nothing', () => {
    renderDialog({ initialTab: 'suggestions' })

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Use 3 photos from Kruger, September 2026'
      })
    )

    expect(screen.getByLabelText('Title')).toHaveValue('Kruger, September 2026')
    expect(screen.getByTestId('album-selection-count')).toHaveTextContent(
      '3 selected'
    )
    // The picker and the review grid share one selection.
    expect(screen.getByTestId('picker')).toHaveTextContent(
      'trip:2026-09-12-1,trip:2026-09-12-2,trip:2026-09-12-3'
    )
    expect(screen.getByTestId('review-of')).toHaveTextContent(trip.id)
    expect(
      screen.getByRole('button', { name: /^Use 3 photos from Kruger/ })
    ).toHaveAttribute('aria-current', 'true')
    expect(create).not.toHaveBeenCalled()
    expect(add).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('lets the owner trim the photos before creating the album', async () => {
    create.mockResolvedValue(result('new'))
    update.mockResolvedValue(buildAlbumCard('new'))
    const { onSaved } = renderDialog({ initialTab: 'suggestions' })

    fireEvent.click(
      screen.getByRole('button', { name: /^Use 3 photos from Kruger/ })
    )
    fireEvent.click(screen.getByText('untick first'))
    expect(screen.getByTestId('album-selection-count')).toHaveTextContent(
      '2 selected'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Create album' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('new'))
    expect(create).toHaveBeenCalledWith({
      title: 'Kruger, September 2026',
      description: null,
      visibility: 'public',
      mediaIds: ['trip:2026-09-12-2', 'trip:2026-09-12-3']
    })
    expect(update).toHaveBeenCalledWith('new', {
      coverMediaId: 'trip:2026-09-12-2'
    })
  })

  it('keeps a title the owner typed', () => {
    renderDialog({ initialTab: 'suggestions' })

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'My trip' }
    })
    fireEvent.click(
      screen.getByRole('button', { name: /^Use 3 photos from Kruger/ })
    )

    expect(screen.getByLabelText('Title')).toHaveValue('My trip')
    expect(screen.getByTestId('album-selection-count')).toHaveTextContent(
      '3 selected'
    )
  })

  it('replaces the title of an earlier suggestion with the next one', () => {
    renderDialog({ initialTab: 'suggestions' })

    fireEvent.click(
      screen.getByRole('button', { name: /^Use 3 photos from Kruger/ })
    )
    fireEvent.click(
      screen.getByRole('button', {
        name: /^Use 3 photos from Common kingfisher/
      })
    )

    expect(screen.getByLabelText('Title')).toHaveValue('Common kingfisher')
    expect(screen.getByTestId('review-selected')).toHaveTextContent('k1,k2,k3')
    expect(screen.getByTestId('review-of')).toHaveTextContent(species.id)
  })

  it('starts the review grid afresh for another suggestion and for the same one used again', () => {
    renderDialog({ initialTab: 'suggestions' })
    const mount = () => screen.getByTestId('review-mount').textContent

    fireEvent.click(
      screen.getByRole('button', { name: /^Use 3 photos from Kruger/ })
    )
    const first = mount()
    fireEvent.click(
      screen.getByRole('button', {
        name: /^Use 3 photos from Common kingfisher/
      })
    )
    const second = mount()
    fireEvent.click(
      screen.getByRole('button', {
        name: /^Use 3 photos from Common kingfisher/
      })
    )

    expect(second).not.toBe(first)
    expect(mount()).not.toBe(second)
  })

  it('shows the cover from the photos the review grid has read', () => {
    renderDialog({ initialTab: 'suggestions' })
    const coverBox = () =>
      screen.getByText('Cover').parentElement as HTMLElement
    expect(coverBox().querySelector('img')).toBeNull()

    fireEvent.click(
      screen.getByRole('button', { name: /^Use 3 photos from Kruger/ })
    )
    fireEvent.click(screen.getByText('untick first'))
    fireEvent.click(screen.getByText('report photos'))

    // The selection now starts with the second photo, which is the cover.
    expect(coverBox().querySelector('img')).not.toBeNull()
  })

  it('keeps the From gallery selection when switching tabs', () => {
    renderDialog()

    selectTab('Suggestions')
    fireEvent.click(
      screen.getByRole('button', { name: /^Use 3 photos from Kruger/ })
    )
    selectTab('From gallery')

    expect(screen.getByTestId('picker')).toHaveTextContent('trip:2026-09-12-1')
  })

  it('shows the loading, error and empty states in the tab', () => {
    const reload = vi.fn()
    const { unmount } = render(
      <GalleryAlbumFormDialog
        open
        ownerId="owner"
        intent="create"
        initialTab="suggestions"
        suggestions={{ state: { status: 'loading' }, reload }}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />
    )
    expect(screen.getByText('Loading suggestions')).toBeInTheDocument()
    unmount()

    const failed = render(
      <GalleryAlbumFormDialog
        open
        ownerId="owner"
        intent="create"
        initialTab="suggestions"
        suggestions={{
          state: { status: 'error', message: 'Too many requests' },
          reload
        }}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Too many requests')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(reload).toHaveBeenCalledTimes(1)
    failed.unmount()

    render(
      <GalleryAlbumFormDialog
        open
        ownerId="owner"
        intent="create"
        initialTab="suggestions"
        suggestions={{ state: ready(), reload }}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />
    )
    expect(screen.getByText('No suggestions right now')).toBeInTheDocument()
  })
})
