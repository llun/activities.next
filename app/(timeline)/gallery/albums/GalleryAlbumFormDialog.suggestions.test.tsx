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
  GalleryAlbumPicker: ({
    albumId,
    selected,
    onChange
  }: {
    albumId?: string
    selected: string[]
    onChange?: (ids: string[]) => void
  }) => (
    <div>
      <span data-testid="picker-album-id">{albumId}</span>
      <span data-testid="picker">{selected.join(',')}</span>
      <button type="button" onClick={() => onChange?.(['pick-1'])}>
        pick one
      </button>
      <button
        type="button"
        onClick={() => onChange?.([...selected, 'manual-1'])}
      >
        manual pick
      </button>
    </div>
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

  it('offers From gallery and Suggestions tabs when creating, From gallery first', async () => {
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
    expect(
      screen.getByText(/adds its photos to the ones you’ve picked/)
    ).toBeInTheDocument()
    expect(await screen.findByTestId('picker-album-id')).toBeEmptyDOMElement()
  })

  it('hides the panel of the tab that is not open, keeping it mounted', () => {
    renderDialog()

    const panels = document.querySelectorAll('[data-slot="tabs-content"]')
    expect(panels).toHaveLength(2)
    expect(panels[0]).toHaveAttribute('data-state', 'active')
    expect(panels[1]).toHaveAttribute('data-state', 'inactive')

    selectTab('Suggestions')
    expect(panels[0]).toHaveAttribute('data-state', 'inactive')
    expect(panels[1]).toHaveAttribute('data-state', 'active')
  })

  it('has no tabs without suggestions, nor when editing', () => {
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

    const view = render(
      <GalleryAlbumFormDialog
        open
        ownerId="owner"
        intent="edit"
        album={buildAlbumCard('a')}
        suggestions={{ state: ready(trip), reload: vi.fn() }}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />
    )
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    view.unmount()
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
      mediaIds: ['trip:2026-09-12-2', 'trip:2026-09-12-3'],
      coverMediaId: 'trip:2026-09-12-2'
    })
    expect(update).not.toHaveBeenCalled()
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

  it('replaces the title of an earlier suggestion with the next one and appends its photos', () => {
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
    expect(screen.getByTestId('review-selected')).toHaveTextContent(
      'trip:2026-09-12-1,trip:2026-09-12-2,trip:2026-09-12-3,k1,k2,k3'
    )
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
    const coverBox = () => screen.getByRole('group', { name: 'Cover' })
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
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
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

  it('adds to an existing selection, skipping already-selected ids and album members, and respects capacity', async () => {
    const { unmount: unmountCreate } = render(
      <GalleryAlbumFormDialog
        open
        ownerId="owner"
        intent="create"
        initialMediaIds={['pre-1', 'k1']}
        initialTab="suggestions"
        suggestions={{ state: ready(species), reload: vi.fn() }}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />
    )
    fireEvent.click(
      screen.getByRole('button', {
        name: /^Use 3 photos from Common kingfisher/
      })
    )
    expect(screen.getByTestId('picker')).toHaveTextContent('pre-1,k1,k2,k3')
    expect(screen.getByTestId('album-toast')).toHaveTextContent(
      'Added 2 photos to your selection'
    )
    unmountCreate()

    const { unmount: unmountAdd } = render(
      <GalleryAlbumFormDialog
        open
        ownerId="owner"
        intent="add"
        album={buildAlbumCard('a1', { itemCount: 1998 })}
        existingMediaIds={['k1']}
        storedItemCount={1998}
        initialTab="gallery"
        suggestions={{ state: ready(species), reload: vi.fn() }}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />
    )
    expect(await screen.findByTestId('picker-album-id')).toHaveTextContent('a1')
    fireEvent.click(screen.getByRole('button', { name: 'pick one' }))
    selectTab('Suggestions')
    fireEvent.click(
      screen.getByRole('button', {
        name: /^Use 2 photos from Common kingfisher/
      })
    )
    expect(screen.getByTestId('picker')).toHaveTextContent('pick-1,k2')
    expect(screen.getByTestId('album-toast')).toHaveTextContent(
      'Added 1 photo to your selection'
    )
    unmountAdd()
  })

  it('displays the toast and updates polite status live region when photos are added', () => {
    renderDialog({ initialTab: 'suggestions' })

    fireEvent.click(
      screen.getByRole('button', {
        name: /^Use 3 photos from Kruger, September 2026/
      })
    )

    expect(screen.getByTestId('album-toast')).toHaveTextContent(
      'Added 3 photos to your selection'
    )
    const statusRegions = screen.getAllByRole('status')
    const politeToastRegion = statusRegions.find(
      (el) => el.textContent === 'Added 3 photos to your selection'
    )
    expect(politeToastRegion).toBeInTheDocument()
    expect(politeToastRegion).toHaveAttribute('aria-live', 'polite')
  })

  it('undo removes only the photos added by the suggestion, keeping later manual picks', () => {
    renderDialog({
      initialMediaIds: ['pre-1', 'pre-2'],
      initialTab: 'suggestions'
    })

    expect(screen.getByTestId('picker')).toHaveTextContent('pre-1,pre-2')

    fireEvent.click(
      screen.getByRole('button', {
        name: /^Use 3 photos from Kruger, September 2026/
      })
    )
    expect(screen.getByTestId('picker')).toHaveTextContent(
      'pre-1,pre-2,trip:2026-09-12-1,trip:2026-09-12-2,trip:2026-09-12-3'
    )

    // User makes a manual pick after using the suggestion
    fireEvent.click(screen.getByRole('button', { name: 'manual pick' }))
    expect(screen.getByTestId('picker')).toHaveTextContent(
      'pre-1,pre-2,trip:2026-09-12-1,trip:2026-09-12-2,trip:2026-09-12-3,manual-1'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    // Undo removes only the suggestion photos and keeps the later manual pick
    expect(screen.getByTestId('picker')).toHaveTextContent(
      'pre-1,pre-2,manual-1'
    )
  })

  it('shows no-undo message when all suggestion photos are already selected', () => {
    renderDialog({
      initialMediaIds: [
        'trip:2026-09-12-1',
        'trip:2026-09-12-2',
        'trip:2026-09-12-3'
      ],
      initialTab: 'suggestions'
    })

    fireEvent.click(
      screen.getByRole('button', {
        name: /^Use 3 photos from Kruger, September 2026/
      })
    )

    expect(screen.getByTestId('album-toast')).toHaveTextContent(
      'These photos are already selected.'
    )
    expect(
      screen.queryByRole('button', { name: 'Undo' })
    ).not.toBeInTheDocument()
    expect(screen.getByTestId('picker')).toHaveTextContent(
      'trip:2026-09-12-1,trip:2026-09-12-2,trip:2026-09-12-3'
    )
  })

  it('shows no-undo message when capacity is reached but there were unselected photos', () => {
    renderDialog({
      intent: 'add',
      album: buildAlbumCard('a1', { itemCount: 2000 }),
      storedItemCount: 2000,
      initialTab: 'suggestions',
      suggestions: { state: ready(species), reload: vi.fn() }
    })

    fireEvent.click(
      screen.getByRole('button', {
        name: /^Use 3 photos from Common kingfisher/
      })
    )

    expect(screen.getByTestId('album-toast')).toHaveTextContent(
      'Your selection is full.'
    )
    expect(
      screen.queryByRole('button', { name: 'Undo' })
    ).not.toBeInTheDocument()
  })

  it('fills title only when untyped in create intent', () => {
    renderDialog({ initialTab: 'suggestions' })

    fireEvent.click(
      screen.getByRole('button', {
        name: /^Use 3 photos from Kruger, September 2026/
      })
    )
    expect(screen.getByLabelText('Title')).toHaveValue('Kruger, September 2026')

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'My custom album title' }
    })
    fireEvent.click(
      screen.getByRole('button', {
        name: /^Use 3 photos from Common kingfisher/
      })
    )
    expect(screen.getByLabelText('Title')).toHaveValue('My custom album title')
  })

  it('shows Suggestions tab in add intent and add-specific copy, but no tab in create without suggestions', () => {
    const { unmount: unmountCreate } = render(
      <GalleryAlbumFormDialog
        open
        ownerId="owner"
        intent="create"
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />
    )
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    unmountCreate()

    render(
      <GalleryAlbumFormDialog
        open
        ownerId="owner"
        intent="add"
        album={buildAlbumCard('a1')}
        suggestions={{ state: ready(trip), reload: vi.fn() }}
        initialTab="suggestions"
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />
    )
    expect(screen.getByRole('tab', { name: 'Suggestions' })).toBeInTheDocument()
    expect(
      screen.getByRole('tab', { name: 'From gallery' })
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Using a suggestion adds its photos to the ones you’ve picked. Photos already in this album are skipped. Nothing is saved until you add the photos.'
      )
    ).toBeInTheDocument()
  })
})
