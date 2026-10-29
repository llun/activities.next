/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'

import {
  GalleryAlbumFormDialog,
  formatAlbumDatesChipLabel
} from '@/app/(timeline)/gallery/albums/GalleryAlbumFormDialog'
import {
  addGalleryAlbumItems,
  createGalleryAlbum,
  updateGalleryAlbum
} from '@/lib/client'
import { GalleryAlbumAddError } from '@/lib/client/galleryAlbums'
import { buildAlbumCard } from '@/lib/components/gallery/__fixtures__/galleryAlbums'
import { buildGalleryItem } from '@/lib/components/gallery/__fixtures__/galleryItems'
import type { GalleryAlbumItemsResult } from '@/lib/services/gallery/galleryAlbumEntities'

vi.mock('@/lib/client', () => ({
  addGalleryAlbumItems: vi.fn(),
  createGalleryAlbum: vi.fn(),
  updateGalleryAlbum: vi.fn()
}))

vi.mock('@/lib/client/galleryAlbums', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/client/galleryAlbums')
  >('@/lib/client/galleryAlbums')
  return { ...actual, GALLERY_ALBUM_ITEMS_BATCH: 2 }
})

// The picker has its own tests: here it only reports picks.
vi.mock('@/app/(timeline)/gallery/albums/GalleryAlbumPicker', () => ({
  GalleryAlbumPicker: ({
    albumId,
    selected,
    onChange,
    onFirstItemChange,
    onItemsLoaded,
    capacity,
    existingIds,
    seedItems,
    disabled,
    initialFilters
  }: {
    albumId?: string
    seedItems?: { mediaId: string }[]
    selected: string[]
    onChange: (ids: string[]) => void
    onFirstItemChange?: (item: unknown) => void
    onItemsLoaded?: (items: unknown[]) => void
    capacity: number
    existingIds?: string[]
    disabled?: boolean
    initialFilters?: unknown
  }) => (
    <div>
      <span data-testid="album-id">{albumId}</span>
      <span data-testid="capacity">{capacity}</span>
      <span data-testid="existing">{existingIds?.join(',')}</span>
      <span data-testid="seed">
        {seedItems?.map((item) => item.mediaId).join(',')}
      </span>
      <span data-testid="picker-disabled">{String(Boolean(disabled))}</span>
      <span data-testid="picker-initial-filters">
        {initialFilters ? JSON.stringify(initialFilters) : 'none'}
      </span>
      <button
        type="button"
        onClick={() => {
          onChange(['m1', 'm2', 'm3'])
          onFirstItemChange?.(buildGalleryItem('m1'))
          onItemsLoaded?.([
            namedItem('m1', 'Kingfisher'),
            namedItem('m2', 'Heron'),
            namedItem('m3', 'Egret')
          ])
        }}
      >
        pick three
      </button>
      <button
        type="button"
        onClick={() => {
          onChange(['m1', 'm2', 'm3', 'm4', 'm5'])
          onFirstItemChange?.(buildGalleryItem('m1'))
          onItemsLoaded?.([
            namedItem('m1', 'Kingfisher'),
            namedItem('m2', 'Heron'),
            namedItem('m3', 'Egret'),
            namedItem('m4', 'Ibis'),
            namedItem('m5', 'Stork')
          ])
        }}
      >
        pick five
      </button>
      <button
        type="button"
        onClick={() => {
          onChange(['m1'])
          onFirstItemChange?.(buildGalleryItem('m1'))
          onItemsLoaded?.([namedItem('m1', 'Kingfisher')])
        }}
      >
        pick one
      </button>
      <button
        type="button"
        onClick={() => {
          // A Select day pick the dialog has no entity for (unloaded), with
          // the first pick still the picker's cover.
          onChange(['m1', 'm2', 'm3', 'z9'])
          onFirstItemChange?.(buildGalleryItem('m1'))
          onItemsLoaded?.([
            namedItem('m1', 'Kingfisher'),
            namedItem('m2', 'Heron'),
            namedItem('m3', 'Egret')
          ])
        }}
      >
        pick with unloaded
      </button>
      <button
        type="button"
        onClick={() => onItemsLoaded?.([namedItem('z9', 'Puffin')])}
      >
        hydrate picked photo
      </button>
      <span data-testid="picked">{selected.join(',')}</span>
    </div>
  )
}))

const namedItem = (mediaId: string, name: string) =>
  buildGalleryItem(mediaId, {
    subject: {
      name,
      scientificName: null,
      category: null,
      taxonKey: null,
      taxonPath: null
    }
  })

const create = vi.mocked(createGalleryAlbum)
const add = vi.mocked(addGalleryAlbumItems)
const update = vi.mocked(updateGalleryAlbum)
const setCoverButton = (name: string) =>
  screen.getByRole('button', {
    name: new RegExp(`^Set ${name}, photo \\d+ of \\d+, as cover$`)
  })
const removePickButton = (name: string) =>
  screen.getByRole('button', {
    name: new RegExp(`^Remove ${name}, photo \\d+ of \\d+ from selection$`)
  })
const coverStatusButton = (name: string) =>
  screen.getByRole('button', {
    name: new RegExp(`^${name}, photo \\d+ of \\d+, is the cover$`)
  })

const result = (
  id: string,
  overrides: Partial<
    Pick<GalleryAlbumItemsResult, 'added' | 'existing' | 'skipped'>
  > = {}
): GalleryAlbumItemsResult => ({
  added: [],
  existing: [],
  skipped: [],
  album: buildAlbumCard(id),
  ...overrides
})

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('GalleryAlbumFormDialog', () => {
  beforeEach(() => {
    // Radix radio buttons measure themselves.
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    create.mockReset()
    add.mockReset()
    update.mockReset()
  })

  const renderDialog = (
    props: Partial<Parameters<typeof GalleryAlbumFormDialog>[0]> = {}
  ) => {
    const onSaved = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <GalleryAlbumFormDialog
        open
        ownerId="owner"
        intent="create"
        onOpenChange={onOpenChange}
        onSaved={onSaved}
        {...props}
      />
    )
    return { onSaved, onOpenChange }
  }

  it('saves nothing until the primary button, then creates with cover, and adds the rest', async () => {
    create.mockResolvedValue(result('new', { added: ['m1', 'm2'] }))
    add.mockResolvedValue(result('new', { added: ['m3'] }))
    update.mockResolvedValue(buildAlbumCard('new'))
    const { onSaved, onOpenChange } = renderDialog()

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: '  Kruger  ' }
    })
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: 'Eight days' }
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Private' }))
    fireEvent.click(await screen.findByText('pick three'))
    expect(create).not.toHaveBeenCalled()
    expect(screen.getByTestId('album-selection-count')).toHaveTextContent(
      '3 selected'
    )
    await waitFor(() =>
      expect(
        within(screen.getByTestId('album-picks-strip')).getByRole('status')
      ).toHaveTextContent('3 selected · max 2,000 per album')
    )

    fireEvent.click(screen.getByRole('button', { name: 'Create album' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('new'))

    expect(create).toHaveBeenCalledWith({
      title: 'Kruger',
      description: 'Eight days',
      visibility: 'private',
      mediaIds: ['m1', 'm2'],
      coverMediaId: 'm1'
    })
    expect(add).toHaveBeenCalledWith('new', ['m3'])
    expect(update).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('creates with coverMediaId in first batch and adds remaining in batches without calling updateGalleryAlbum when 150 items are selected', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `item-${i + 1}`)
    create.mockResolvedValue(result('new', { added: ids.slice(0, 2) }))
    add.mockResolvedValue(result('new', { added: ids.slice(2) }))
    const { onSaved } = renderDialog({ initialMediaIds: ids })

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Big Album' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create album' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('new'))

    // In this test file, GALLERY_ALBUM_ITEMS_BATCH is mocked to 2
    expect(create).toHaveBeenCalledWith({
      title: 'Big Album',
      description: null,
      visibility: 'public',
      mediaIds: ['item-1', 'item-2'],
      coverMediaId: 'item-1'
    })
    expect(add).toHaveBeenCalledWith('new', ids.slice(2))
    expect(update).not.toHaveBeenCalled()
  })

  it('does not warn when the default cover is skipped during create', async () => {
    create.mockResolvedValue(result('new', { skipped: ['m1'] }))
    const { onSaved, onOpenChange } = renderDialog({
      initialMediaIds: ['m1'],
      initialItems: [namedItem('m1', 'Kingfisher')]
    })

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Trip' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create album' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('new'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(add).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('does not warn that the cover is unchanged when the first batch added it', async () => {
    create.mockResolvedValue(result('new', { added: ['m1', 'm2'] }))
    add.mockRejectedValue(
      new GalleryAlbumAddError('Later batch failed.', 500, null)
    )
    renderDialog({
      initialMediaIds: ['m1', 'm2', 'm3'],
      initialItems: [
        namedItem('m1', 'Kingfisher'),
        namedItem('m2', 'Heron'),
        namedItem('m3', 'Egret')
      ]
    })

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Trip' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create album' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The album was created, but not everything was added: Later batch failed.'
    )
    expect(
      screen.queryByText(/Kingfisher wasn’t added/)
    ).not.toBeInTheDocument()
    expect(create.mock.calls[0][0].coverMediaId).toBe('m1')
  })

  it('applies a starred photo from partial later batches before showing the error', async () => {
    create.mockResolvedValue(result('new', { added: ['m1', 'm2'] }))
    add.mockRejectedValue(
      new GalleryAlbumAddError(
        'Later batch failed.',
        500,
        result('new', { added: ['m3'] })
      )
    )
    update.mockResolvedValue(buildAlbumCard('new'))
    renderDialog({
      initialMediaIds: ['m1', 'm2', 'm3'],
      initialItems: [
        namedItem('m1', 'Kingfisher'),
        namedItem('m2', 'Heron'),
        namedItem('m3', 'Egret')
      ]
    })

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Trip' }
    })
    fireEvent.click(setCoverButton('Egret'))
    fireEvent.click(screen.getByRole('button', { name: 'Create album' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The album was created, but not everything was added: Later batch failed.'
    )
    expect(update).toHaveBeenCalledWith('new', { coverMediaId: 'm3' })
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaIds: ['m1', 'm2'],
        coverMediaId: undefined
      })
    )
  })

  it('keeps the create error and warns when an explicitly starred later batch photo fails', async () => {
    create.mockResolvedValue(result('new', { added: ['m1', 'm2'] }))
    add.mockRejectedValue(
      new GalleryAlbumAddError('Later batch failed.', 500, null)
    )
    const { onSaved, onOpenChange } = renderDialog({
      initialMediaIds: ['m1', 'm2', 'm3'],
      initialItems: [
        namedItem('m1', 'Kingfisher'),
        namedItem('m2', 'Heron'),
        namedItem('m3', 'Egret')
      ]
    })

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Trip' }
    })
    fireEvent.click(setCoverButton('Egret'))
    fireEvent.click(screen.getByRole('button', { name: 'Create album' }))

    expect(
      await screen.findByText(
        'The album was created, but not everything was added: Later batch failed.'
      )
    ).toBeVisible()
    expect(
      screen.getByText(
        'The album was created, but Egret wasn’t added, so the cover is unchanged.'
      )
    ).toBeVisible()
    expect(onSaved).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(update).not.toHaveBeenCalled()
  })

  it('shows a hydrated photo thumbnail in the picks strip', async () => {
    renderDialog()
    fireEvent.click(await screen.findByText('pick with unloaded'))

    const strip = screen.getByTestId('album-picks-desktop')
    const hydratedThumbnail =
      'img[src="https://activities.local/media/z9-thumb.jpg"]'
    expect(strip.querySelector(hydratedThumbnail)).not.toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'hydrate picked photo' })
    )

    await waitFor(() => {
      expect(strip.querySelector(hydratedThumbnail)).toBeInTheDocument()
    })

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Set Puffin, photo 4 of 4, as cover'
      })
    )
    const cover = screen.getByRole('group', { name: 'Cover' })
    await waitFor(() => {
      expect(cover.querySelector(hydratedThumbnail)).toBeInTheDocument()
    })
  })

  it('shows thumbnails for photos hydrated after the dialog opened', () => {
    // All media opens the dialog while background hydration is still
    // running, then loads the missing entities of the seeded selection.
    const props = {
      ownerId: 'owner',
      intent: 'create' as const,
      initialMediaIds: ['p1', 'p2'],
      onOpenChange: vi.fn(),
      onSaved: vi.fn()
    }
    const { rerender } = render(
      <GalleryAlbumFormDialog
        open
        {...props}
        initialItems={[namedItem('p1', 'Kingfisher')]}
      />
    )
    const p2Thumb = 'img[src="https://activities.local/media/p2-thumb.jpg"]'
    expect(
      screen.getByTestId('album-picks-desktop').querySelector(p2Thumb)
    ).not.toBeInTheDocument()

    // Star the not-yet-loaded pick: the Cover field cannot show it yet.
    fireEvent.click(
      screen.getByRole('button', { name: 'Set photo 2 of 2 as cover' })
    )
    const cover = screen.getByRole('group', { name: 'Cover' })
    expect(cover.querySelector(p2Thumb)).not.toBeInTheDocument()

    // The host finishes hydrating the second pick while the dialog is open.
    rerender(
      <GalleryAlbumFormDialog
        open
        {...props}
        initialItems={[namedItem('p1', 'Kingfisher'), namedItem('p2', 'Heron')]}
      />
    )

    expect(
      screen.getByTestId('album-picks-desktop').querySelector(p2Thumb)
    ).toBeInTheDocument()
    expect(
      screen.getByRole('group', { name: 'Cover' }).querySelector(p2Thumb)
    ).toBeInTheDocument()
  })

  it('needs a title and does not call the server without one', () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Create album' }))
    expect(screen.getByLabelText('Title')).toHaveAccessibleDescription(
      'Give the album a title.'
    )
    expect(screen.getByLabelText('Title')).toBeInvalid()
    expect(screen.getByLabelText('Title')).toHaveFocus()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Trip' }
    })
    expect(screen.getByLabelText('Title')).not.toBeInvalid()
    expect(
      screen.queryByText('Give the album a title.')
    ).not.toBeInTheDocument()
  })

  it('creates an empty album as public by default', async () => {
    create.mockResolvedValue(result('new'))
    const { onSaved } = renderDialog()
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Empty' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create album' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('new'))
    expect(create).toHaveBeenCalledWith({
      title: 'Empty',
      description: null,
      visibility: 'public',
      mediaIds: []
    })
    expect(update).not.toHaveBeenCalled()
  })

  it('keeps the dialog open with the error when the create fails', async () => {
    create.mockRejectedValue(new Error('Too many albums.'))
    const { onSaved, onOpenChange } = renderDialog()
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'One' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create album' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many albums.'
    )
    expect(onSaved).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('opens the album it created when a later step fails, instead of creating a second', async () => {
    create.mockResolvedValue(result('new'))
    add.mockRejectedValue(new Error('Album is full.'))
    const { onSaved } = renderDialog()
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'One' }
    })
    fireEvent.click(await screen.findByText('pick three'))
    fireEvent.click(screen.getByRole('button', { name: 'Create album' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The album was created, but not everything was added: Album is full.'
    )
    expect(onSaved).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Open album' }))
    expect(onSaved).toHaveBeenCalledWith('new')
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('calls the secondary button Close and locks the fields once the album exists', async () => {
    create.mockResolvedValue(result('new'))
    add.mockRejectedValue(new Error('Album is full.'))
    renderDialog()
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'One' }
    })
    fireEvent.click(await screen.findByText('pick three'))
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.getByTestId('picker-disabled')).toHaveTextContent('false')

    fireEvent.click(screen.getByRole('button', { name: 'Create album' }))
    await screen.findByRole('alert')

    // The dialog's own X is also named Close; the footer button joins it.
    expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(2)
    expect(
      screen.queryByRole('button', { name: 'Cancel' })
    ).not.toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toBeDisabled()
    expect(screen.getByLabelText(/Description/)).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'Private' })).toBeDisabled()
    expect(screen.getByTestId('picker-disabled')).toHaveTextContent('true')
  })

  it('moves between the visibility choices with the arrow keys', async () => {
    renderDialog()
    const group = screen.getByRole('radiogroup', { name: 'Visibility' })
    expect(group).toBeInTheDocument()
    const publicRadio = screen.getByRole('radio', { name: 'Public' })
    expect(publicRadio).toHaveAttribute('aria-checked', 'true')

    publicRadio.focus()
    fireEvent.keyDown(publicRadio, { key: 'ArrowDown' })

    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Private' })).toHaveAttribute(
        'aria-checked',
        'true'
      )
    )
  })

  it('puts Cancel before the primary button, as it reads', () => {
    renderDialog()
    const buttons = screen.getAllByRole('button')
    const cancel = buttons.findIndex(
      (button) => button.textContent === 'Cancel'
    )
    const create = buttons.findIndex(
      (button) => button.textContent === 'Create album'
    )
    expect(cancel).toBeGreaterThan(-1)
    expect(cancel).toBeLessThan(create)
  })

  it('edits the details only, from the album', async () => {
    update.mockResolvedValue(buildAlbumCard('a1'))
    const album = buildAlbumCard('a1', {
      title: 'Old',
      description: 'Old text',
      visibility: 'private'
    })
    const { onSaved } = renderDialog({ intent: 'edit', album })

    expect(screen.queryByTestId('capacity')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveValue('Old')
    expect(screen.getByRole('radio', { name: 'Private' })).toHaveAttribute(
      'aria-checked',
      'true'
    )

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'New' }
    })
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: '' }
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Public' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('a1'))
    expect(update).toHaveBeenCalledWith('a1', {
      title: 'New',
      description: null,
      visibility: 'public'
    })
    expect(create).not.toHaveBeenCalled()
  })

  it('adds photos to an album within what it has room for', async () => {
    add.mockResolvedValue(result('a1'))
    const album = buildAlbumCard('a1', { itemCount: 1990 })
    const { onSaved } = renderDialog({ intent: 'add', album })

    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument()
    expect(screen.getByTestId('capacity')).toHaveTextContent('10')
    expect(screen.getByTestId('album-selection-count')).toHaveTextContent(
      'Room for 10'
    )
    expect(
      screen.getByText('0 selected · room for 10 more')
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add to album' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Choose at least one photo.'
    )

    fireEvent.click(await screen.findByText('pick three'))
    expect(screen.getByTestId('album-selection-count')).toHaveTextContent(
      'Room for 7'
    )
    expect(screen.getByText('3 selected · room for 7 more')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Add 3 photos/ }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('a1'))
    expect(add).toHaveBeenCalledWith('a1', ['m1', 'm2', 'm3'])
  })

  it('passes the photos already in the album to the picker', () => {
    renderDialog({
      intent: 'add',
      album: buildAlbumCard('a1', { itemCount: 2 }),
      existingMediaIds: ['x1', 'x2']
    })
    expect(screen.getByTestId('album-id')).toHaveTextContent('a1')
    expect(screen.getByTestId('existing')).toHaveTextContent('x1,x2')
  })

  it('passes the album id to the picker when adding, and undefined when creating', () => {
    const { unmount } = render(
      <GalleryAlbumFormDialog
        open
        ownerId="owner"
        intent="create"
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />
    )
    expect(screen.getByTestId('album-id')).toBeEmptyDOMElement()
    unmount()

    render(
      <GalleryAlbumFormDialog
        open
        ownerId="owner"
        intent="add"
        album={buildAlbumCard('a1')}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />
    )
    expect(screen.getByTestId('album-id')).toHaveTextContent('a1')
  })

  it('describes what each visibility choice lets other people open', () => {
    renderDialog({ intent: 'edit', album: buildAlbumCard('a1') })
    expect(
      screen.getByText(
        'Anyone with the link can open it, and sees only the photos from posts they may read.'
      )
    ).toBeInTheDocument()
    expect(screen.getByText('Only you can see it.')).toBeInTheDocument()
    // The page exists now: no "arrives later" wording is left.
    expect(screen.queryByText(/public album pages/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/arrive/i)).not.toBeInTheDocument()
  })

  it('counts room against the stored items, not only the visible ones', () => {
    // 1,950 photos show, but 50 more rows (deleted posts) hold their places.
    const album = buildAlbumCard('a1', { itemCount: 1950 })
    renderDialog({ intent: 'add', album, storedItemCount: 2000 })

    expect(screen.getByTestId('capacity')).toHaveTextContent('0')
    expect(screen.getByTestId('album-selection-count')).toHaveTextContent(
      'Room for 0'
    )
    expect(screen.getByText('0 selected · album full')).toBeInTheDocument()
  })

  it('falls back to the visible count when no stored count is given', () => {
    renderDialog({
      intent: 'add',
      album: buildAlbumCard('a1', { itemCount: 1950 })
    })
    expect(screen.getByTestId('capacity')).toHaveTextContent('50')
  })

  it('closes on Cancel without saving', () => {
    const { onOpenChange } = renderDialog()
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Draft' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(create).not.toHaveBeenCalled()
  })

  describe('started with photos', () => {
    it('starts with the photos already picked and says so', () => {
      renderDialog({ initialMediaIds: ['p1', 'p2'] })

      expect(screen.getByTestId('picked')).toHaveTextContent('p1,p2')
      expect(screen.getByTestId('album-selection-count')).toHaveTextContent(
        '2 selected'
      )
      expect(
        screen.getByText(/The 2 photos you chose are already selected\./)
      ).toBeVisible()
    })

    it('says photo in the singular for one', () => {
      renderDialog({ initialMediaIds: ['p1'] })

      expect(
        screen.getByText(/The photo you chose is already selected\./)
      ).toBeVisible()
    })

    it('gives the picker the loaded photos for the cover', () => {
      renderDialog({
        initialMediaIds: ['p1'],
        initialItems: [buildGalleryItem('p1')]
      })

      expect(screen.getByTestId('seed')).toHaveTextContent('p1')
    })

    it('creates the album with them and the first as the cover', async () => {
      create.mockResolvedValue(result('new', { added: ['p1', 'p2'] }))
      update.mockResolvedValue(buildAlbumCard('new'))
      const { onSaved } = renderDialog({ initialMediaIds: ['p1', 'p2'] })

      fireEvent.change(screen.getByLabelText('Title'), {
        target: { value: 'Pair' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Create album' }))
      await waitFor(() => expect(onSaved).toHaveBeenCalledWith('new'))

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Pair',
          mediaIds: ['p1', 'p2'],
          coverMediaId: 'p1'
        })
      )
      expect(update).not.toHaveBeenCalled()
    })

    it('starts again from them each time it opens, not from earlier edits', async () => {
      const props = {
        ownerId: 'owner',
        intent: 'create' as const,
        initialMediaIds: ['p1'],
        onOpenChange: vi.fn(),
        onSaved: vi.fn()
      }
      const { rerender } = render(<GalleryAlbumFormDialog open {...props} />)
      fireEvent.click(await screen.findByText('pick three'))
      expect(screen.getByTestId('picked')).toHaveTextContent('m1,m2,m3')

      // A parent that builds a new array every render must not undo the picks.
      rerender(
        <GalleryAlbumFormDialog open {...props} initialMediaIds={['p1']} />
      )
      expect(screen.getByTestId('picked')).toHaveTextContent('m1,m2,m3')

      rerender(<GalleryAlbumFormDialog open={false} {...props} />)
      rerender(<GalleryAlbumFormDialog open {...props} />)
      expect(screen.getByTestId('picked')).toHaveTextContent('p1')
    })

    it('ignores them when adding to an album', () => {
      renderDialog({
        intent: 'add',
        album: buildAlbumCard('a1'),
        initialMediaIds: ['p1']
      })

      expect(screen.getByTestId('picked')).toHaveTextContent('')
      expect(screen.queryByText(/you chose are already/)).toBeNull()
    })
  })

  describe('formatAlbumDatesChipLabel', () => {
    it.each`
      firstAt                       | lastAt                        | label
      ${'2025-10-04T09:00:00.000Z'} | ${'2025-10-12T09:00:00.000Z'} | ${'Album dates · 4–12 Oct 2025'}
      ${'2025-09-28T09:00:00.000Z'} | ${'2025-10-04T09:00:00.000Z'} | ${'Album dates · 28 Sep – 4 Oct 2025'}
      ${'2025-12-28T09:00:00.000Z'} | ${'2026-01-04T09:00:00.000Z'} | ${'Album dates · 28 Dec 2025 – 4 Jan 2026'}
      ${'2025-10-04T09:00:00.000Z'} | ${'2025-10-04T15:00:00.000Z'} | ${'Album dates · 4 Oct 2025'}
    `(
      'labels $firstAt to $lastAt as "$label"',
      ({ firstAt, lastAt, label }) => {
        expect(formatAlbumDatesChipLabel(firstAt, lastAt)).toBe(label)
      }
    )
  })

  describe('picks strip and cover star', () => {
    it('sends the first pick as the cover by default when creating', async () => {
      create.mockResolvedValue(result('new', { added: ['m1', 'm2'] }))
      renderDialog()
      fireEvent.change(screen.getByLabelText('Title'), {
        target: { value: 'Trip' }
      })
      fireEvent.click(await screen.findByText('pick three'))
      fireEvent.click(screen.getByRole('button', { name: 'Create album' }))
      await waitFor(() => expect(create).toHaveBeenCalled())
      expect(create.mock.calls[0][0].coverMediaId).toBe('m1')
      expect(update).not.toHaveBeenCalled()
    })

    it('sends the starred pick as the cover when creating', async () => {
      create.mockResolvedValue(result('new', { added: ['m1', 'm2'] }))
      renderDialog()
      fireEvent.change(screen.getByLabelText('Title'), {
        target: { value: 'Trip' }
      })
      fireEvent.click(await screen.findByText('pick three'))
      fireEvent.click(setCoverButton('Heron'))
      fireEvent.click(screen.getByRole('button', { name: 'Create album' }))
      await waitFor(() => expect(create).toHaveBeenCalled())
      expect(create.mock.calls[0][0].coverMediaId).toBe('m2')
      expect(update).not.toHaveBeenCalled()
    })

    it('patches the cover after adding, only when the starred pick was added', async () => {
      add.mockResolvedValue({
        added: ['m1', 'm2', 'm3'],
        existing: [],
        skipped: [],
        album: buildAlbumCard('a1')
      } as never)
      update.mockResolvedValue(buildAlbumCard('a1'))
      const { onSaved } = renderDialog({
        intent: 'add',
        album: buildAlbumCard('a1')
      })

      fireEvent.click(await screen.findByText('pick three'))
      fireEvent.click(setCoverButton('Heron'))
      fireEvent.click(screen.getByRole('button', { name: /Add 3 photos/ }))
      await waitFor(() => expect(onSaved).toHaveBeenCalledWith('a1'))

      expect(add).toHaveBeenCalledWith('a1', ['m1', 'm2', 'm3'])
      expect(update).toHaveBeenCalledWith('a1', { coverMediaId: 'm2' })
    })

    it('unstars the cover in the add intent and adds without patching the cover', async () => {
      add.mockResolvedValue(result('a1', { added: ['m1', 'm2', 'm3'] }))
      const { onSaved } = renderDialog({
        intent: 'add',
        album: buildAlbumCard('a1')
      })

      fireEvent.click(await screen.findByText('pick three'))
      fireEvent.click(setCoverButton('Heron'))
      expect(screen.getByTestId('album-selection-count')).toHaveTextContent(
        '★ Heron becomes the cover'
      )

      // Pressing ★ on the starred pick clears the star again: the footer
      // note goes and no cover PATCH follows the add.
      fireEvent.click(coverStatusButton('Heron'))
      expect(screen.getByTestId('album-selection-count')).toHaveTextContent(
        'Room for 1,994'
      )

      fireEvent.click(screen.getByRole('button', { name: /Add 3 photos/ }))
      await waitFor(() => expect(onSaved).toHaveBeenCalledWith('a1'))

      expect(add).toHaveBeenCalledWith('a1', ['m1', 'm2', 'm3'])
      expect(update).not.toHaveBeenCalled()
    })

    it('calls onSaved when closing after a partial add failure', async () => {
      add.mockRejectedValue(
        new GalleryAlbumAddError(
          'Later batch failed.',
          500,
          result('a1', { added: ['m1'] })
        )
      )
      const { onSaved, onOpenChange } = renderDialog({
        intent: 'add',
        album: buildAlbumCard('a1')
      })

      fireEvent.click(await screen.findByText('pick three'))
      fireEvent.click(screen.getByRole('button', { name: /Add 3 photos/ }))
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Later batch failed.'
      )

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(onSaved).toHaveBeenCalledWith('a1')
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('keeps Add retryable after a partial add failure', async () => {
      add
        .mockRejectedValueOnce(
          new GalleryAlbumAddError(
            'Later batch failed.',
            500,
            result('a1', { added: ['m1'] })
          )
        )
        .mockResolvedValueOnce(
          result('a1', { added: ['m2', 'm3'], existing: ['m1'] })
        )
      const { onSaved } = renderDialog({
        intent: 'add',
        album: buildAlbumCard('a1')
      })

      fireEvent.click(await screen.findByText('pick three'))
      fireEvent.click(screen.getByRole('button', { name: /Add 3 photos/ }))
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Later batch failed.'
      )
      expect(screen.getByRole('button', { name: /Add 3 photos/ })).toBeEnabled()
      expect(screen.getByTestId('picker-disabled')).toHaveTextContent('false')

      fireEvent.click(screen.getByRole('button', { name: /Add 3 photos/ }))
      await waitFor(() => expect(onSaved).toHaveBeenCalledWith('a1'))
      expect(add).toHaveBeenCalledTimes(2)
    })

    it('patches the cover from a partial add failure when the starred pick made it in', async () => {
      add.mockRejectedValue(
        new GalleryAlbumAddError(
          'Later batch failed.',
          500,
          result('a1', { added: ['m1', 'm2'] })
        )
      )
      update.mockResolvedValue(buildAlbumCard('a1'))
      const { onSaved, onOpenChange } = renderDialog({
        intent: 'add',
        album: buildAlbumCard('a1')
      })

      fireEvent.click(await screen.findByText('pick three'))
      fireEvent.click(setCoverButton('Heron'))
      fireEvent.click(screen.getByRole('button', { name: /Add 3 photos/ }))

      expect(await screen.findByText('Later batch failed.')).toBeInTheDocument()
      await waitFor(() =>
        expect(update).toHaveBeenCalledWith('a1', { coverMediaId: 'm2' })
      )
      expect(
        screen.queryByText(/wasn’t added, so the cover is unchanged/)
      ).not.toBeInTheDocument()
      expect(onSaved).not.toHaveBeenCalled()
      expect(onOpenChange).not.toHaveBeenCalledWith(false)
    })

    it('warns the cover is unchanged when a partial add failure skipped the star', async () => {
      add.mockRejectedValue(
        new GalleryAlbumAddError(
          'Later batch failed.',
          500,
          result('a1', { added: ['m1'] })
        )
      )
      const { onSaved } = renderDialog({
        intent: 'add',
        album: buildAlbumCard('a1')
      })

      fireEvent.click(await screen.findByText('pick three'))
      fireEvent.click(setCoverButton('Heron'))
      fireEvent.click(screen.getByRole('button', { name: /Add 3 photos/ }))

      expect(await screen.findByText('Later batch failed.')).toBeInTheDocument()
      expect(
        screen.getByText(
          'Added 1 photo, but Heron wasn’t added, so the cover is unchanged.'
        )
      ).toBeInTheDocument()
      expect(update).not.toHaveBeenCalled()
      expect(onSaved).not.toHaveBeenCalled()
    })

    it('does not patch the cover without a star', async () => {
      add.mockResolvedValue(result('a1'))
      const { onSaved } = renderDialog({
        intent: 'add',
        album: buildAlbumCard('a1')
      })

      fireEvent.click(await screen.findByText('pick three'))
      fireEvent.click(screen.getByRole('button', { name: /Add 3 photos/ }))
      await waitFor(() => expect(onSaved).toHaveBeenCalledWith('a1'))
      expect(update).not.toHaveBeenCalled()
    })

    it('warns and locks when the starred pick was not added', async () => {
      add.mockResolvedValue({
        added: ['m1', 'm3'],
        existing: [],
        skipped: [],
        album: buildAlbumCard('a1')
      } as never)
      const { onSaved, onOpenChange } = renderDialog({
        intent: 'add',
        album: buildAlbumCard('a1')
      })

      fireEvent.click(await screen.findByText('pick three'))
      fireEvent.click(setCoverButton('Heron'))
      fireEvent.click(screen.getByRole('button', { name: /Add 3 photos/ }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Added 2 photos, but Heron wasn’t added, so the cover is unchanged.'
      )
      expect(update).not.toHaveBeenCalled()
      expect(onSaved).not.toHaveBeenCalled()
      expect(onOpenChange).not.toHaveBeenCalledWith(false)

      fireEvent.click(screen.getByRole('button', { name: 'Open album' }))
      expect(onSaved).toHaveBeenCalledWith('a1')
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('shows the error and locks when the cover patch is rejected', async () => {
      add.mockResolvedValue({
        added: ['m1', 'm2', 'm3'],
        existing: [],
        skipped: [],
        album: buildAlbumCard('a1')
      } as never)
      update.mockRejectedValue(new Error('Cover failed.'))
      const { onSaved } = renderDialog({
        intent: 'add',
        album: buildAlbumCard('a1')
      })

      fireEvent.click(await screen.findByText('pick three'))
      fireEvent.click(setCoverButton('Heron'))
      fireEvent.click(screen.getByRole('button', { name: /Add 3 photos/ }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Added 3 photos, but the cover wasn’t changed: Cover failed.'
      )
      expect(onSaved).not.toHaveBeenCalled()

      fireEvent.click(screen.getByRole('button', { name: 'Open album' }))
      expect(onSaved).toHaveBeenCalledWith('a1')
    })

    it('sets the cover after the rest is added when the star is beyond the first batch', async () => {
      create.mockResolvedValue(result('new'))
      add.mockResolvedValue({
        added: ['m3'],
        existing: [],
        skipped: [],
        album: buildAlbumCard('new')
      } as never)
      update.mockResolvedValue(buildAlbumCard('new'))
      const { onSaved } = renderDialog()

      fireEvent.change(screen.getByLabelText('Title'), {
        target: { value: 'Big' }
      })
      fireEvent.click(await screen.findByText('pick three'))
      fireEvent.click(setCoverButton('Egret'))
      fireEvent.click(screen.getByRole('button', { name: 'Create album' }))

      await waitFor(() => expect(onSaved).toHaveBeenCalledWith('new'))
      // In this test file, GALLERY_ALBUM_ITEMS_BATCH is mocked to 2
      expect(create.mock.calls[0][0].mediaIds).toEqual(['m1', 'm2'])
      expect(create.mock.calls[0][0].coverMediaId).toBeUndefined()
      expect(add).toHaveBeenCalledWith('new', ['m3'])
      expect(update).toHaveBeenCalledWith('new', { coverMediaId: 'm3' })
    })

    it('reports a create cover patch failure separately from an add failure', async () => {
      create.mockResolvedValue(result('new', { added: ['m1', 'm2'] }))
      add.mockResolvedValue(result('new', { added: ['m3'] }))
      update.mockRejectedValue(new Error('Cover failed.'))
      const { onSaved } = renderDialog({
        initialMediaIds: ['m1', 'm2', 'm3'],
        initialItems: [
          namedItem('m1', 'Kingfisher'),
          namedItem('m2', 'Heron'),
          namedItem('m3', 'Egret')
        ]
      })

      fireEvent.change(screen.getByLabelText('Title'), {
        target: { value: 'Trip' }
      })
      fireEvent.click(setCoverButton('Egret'))
      fireEvent.click(screen.getByRole('button', { name: 'Create album' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Added 3 photos, but the cover wasn’t changed: Cover failed.'
      )
      expect(
        screen.queryByText(/not everything was added/)
      ).not.toBeInTheDocument()
      expect(onSaved).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'Open album' })).toBeEnabled()
    })

    it('keeps the star when the create fails, and retries with the same cover', async () => {
      create.mockRejectedValueOnce(new Error('Too many albums.'))
      create.mockResolvedValueOnce(result('new', { added: ['m1', 'm2'] }))
      add.mockResolvedValue(result('new', { added: ['m3'] }))
      const { onSaved } = renderDialog()
      fireEvent.change(screen.getByLabelText('Title'), {
        target: { value: 'Trip' }
      })
      fireEvent.click(await screen.findByText('pick three'))
      fireEvent.click(setCoverButton('Heron'))
      fireEvent.click(screen.getByRole('button', { name: 'Create album' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Too many albums.'
      )
      expect(coverStatusButton('Heron')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Create album' }))
      await waitFor(() => expect(onSaved).toHaveBeenCalledWith('new'))
      expect(create).toHaveBeenCalledTimes(2)
      expect(create.mock.calls[1][0].coverMediaId).toBe('m2')
    })

    it('seeds Add photos with the album dates as a custom filter', () => {
      renderDialog({
        intent: 'add',
        album: buildAlbumCard('a1', {
          firstAt: '2025-10-04T09:00:00.000Z',
          lastAt: '2025-10-12T09:00:00.000Z'
        })
      })

      const filters = screen.getByTestId('picker-initial-filters').textContent
      expect(filters).toContain('"kind":"custom"')
      expect(filters).toContain('"from":"2025-10-04"')
      expect(filters).toContain('"to":"2025-10-12"')
      expect(filters).toContain('"label":"Album dates · 4–12 Oct 2025"')
    })

    it('passes no seeded filters for an empty album', () => {
      renderDialog({
        intent: 'add',
        album: buildAlbumCard('a1', { firstAt: null, lastAt: null })
      })
      expect(screen.getByTestId('picker-initial-filters')).toHaveTextContent(
        'none'
      )
    })

    it('passes no seeded filters when creating', () => {
      renderDialog()
      expect(screen.getByTestId('picker-initial-filters')).toHaveTextContent(
        'none'
      )
    })

    it('names the photo that becomes the cover in the footer', async () => {
      renderDialog({ intent: 'add', album: buildAlbumCard('a1') })

      fireEvent.click(await screen.findByText('pick three'))
      expect(screen.getByTestId('album-selection-count')).toHaveTextContent(
        'Room for 1,994'
      )

      fireEvent.click(setCoverButton('Kingfisher'))
      expect(screen.getByTestId('album-selection-count')).toHaveTextContent(
        '★ Kingfisher becomes the cover'
      )
    })

    it('labels the submit button with the number of photos being added', async () => {
      renderDialog({ intent: 'add', album: buildAlbumCard('a1') })

      fireEvent.click(await screen.findByText('pick five'))
      expect(
        screen.getByRole('button', { name: /Add 5 photos/ })
      ).toBeInTheDocument()
    })

    it('hints at the star on the cover field', () => {
      renderDialog()
      expect(
        screen.getByText('Tap ☆ on a pick to change it')
      ).toBeInTheDocument()
    })

    it('moves the star back to the first pick when the starred pick is removed (create)', async () => {
      renderDialog()
      fireEvent.click(await screen.findByText('pick three'))
      fireEvent.click(setCoverButton('Heron'))
      expect(coverStatusButton('Heron')).toBeInTheDocument()

      fireEvent.click(removePickButton('Heron'))
      expect(
        screen.getByRole('button', {
          name: /^Kingfisher, photo \d+ of \d+, is the cover$/
        })
      ).toBeInTheDocument()
    })

    it('clears the star when the starred pick is removed (add)', async () => {
      renderDialog({ intent: 'add', album: buildAlbumCard('a1') })
      fireEvent.click(await screen.findByText('pick three'))
      fireEvent.click(setCoverButton('Heron'))
      fireEvent.click(removePickButton('Heron'))

      expect(setCoverButton('Kingfisher')).toBeInTheDocument()
      expect(
        screen.queryByRole('button', {
          name: /^Kingfisher, photo \d+ of \d+, is the cover$/
        })
      ).not.toBeInTheDocument()
      expect(screen.getByTestId('album-selection-count')).toHaveTextContent(
        'Room for 1,995'
      )
    })

    it('clears the picks from the strip without submitting the form', async () => {
      create.mockResolvedValue(result('new'))
      const { onSaved, onOpenChange } = renderDialog()
      fireEvent.click(await screen.findByText('pick three'))
      await waitFor(() =>
        expect(
          within(screen.getByTestId('album-picks-strip')).getByRole('status')
        ).toHaveTextContent('3 selected · max 2,000 per album')
      )
      expect(screen.getByTestId('album-selection-count')).not.toHaveAttribute(
        'aria-live'
      )

      fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

      expect(screen.getByTestId('picked')).toHaveTextContent('')
      await waitFor(() =>
        expect(
          within(screen.getByTestId('album-picks-strip')).getByRole('status')
        ).toHaveTextContent('0 selected · max 2,000 per album')
      )
      // Clear is not a submit: the blank title never becomes an error and
      // nothing is created.
      expect(
        screen.queryByText('Give the album a title.')
      ).not.toBeInTheDocument()
      expect(create).not.toHaveBeenCalled()
      expect(onSaved).not.toHaveBeenCalled()
      expect(onOpenChange).not.toHaveBeenCalledWith(false)
    })

    it('clears the picks from the strip without adding them (add)', async () => {
      add.mockResolvedValue(result('a1'))
      const { onSaved, onOpenChange } = renderDialog({
        intent: 'add',
        album: buildAlbumCard('a1')
      })
      fireEvent.click(await screen.findByText('pick three'))

      fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

      expect(screen.getByTestId('picked')).toHaveTextContent('')
      expect(add).not.toHaveBeenCalled()
      expect(onSaved).not.toHaveBeenCalled()
      expect(onOpenChange).not.toHaveBeenCalledWith(false)
    })

    it('patches the cover when a retry reports the starred pick as existing', async () => {
      // A partial batch failure left the starred photo in the album: the
      // retry's answer carries it under existing, not added.
      add.mockResolvedValue({
        added: ['m3'],
        existing: ['m1', 'm2'],
        skipped: [],
        album: buildAlbumCard('a1')
      } as never)
      update.mockResolvedValue(buildAlbumCard('a1'))
      const { onSaved } = renderDialog({
        intent: 'add',
        album: buildAlbumCard('a1')
      })

      fireEvent.click(await screen.findByText('pick three'))
      fireEvent.click(setCoverButton('Kingfisher'))
      fireEvent.click(screen.getByRole('button', { name: /Add 3 photos/ }))
      await waitFor(() => expect(onSaved).toHaveBeenCalledWith('a1'))

      expect(update).toHaveBeenCalledWith('a1', { coverMediaId: 'm1' })
    })

    it('warns when the starred pick beyond the first batch was not added (create)', async () => {
      create.mockResolvedValue(result('new'))
      add.mockResolvedValue({
        added: [],
        existing: [],
        skipped: [],
        album: buildAlbumCard('new')
      } as never)
      const { onSaved, onOpenChange } = renderDialog()

      fireEvent.change(screen.getByLabelText('Title'), {
        target: { value: 'Big' }
      })
      fireEvent.click(await screen.findByText('pick three'))
      fireEvent.click(setCoverButton('Egret'))
      fireEvent.click(screen.getByRole('button', { name: 'Create album' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'The album was created, but Egret wasn’t added, so the cover is unchanged.'
      )
      expect(update).not.toHaveBeenCalled()
      expect(onSaved).not.toHaveBeenCalled()
      expect(onOpenChange).not.toHaveBeenCalledWith(false)

      fireEvent.click(screen.getByRole('button', { name: 'Open album' }))
      expect(onSaved).toHaveBeenCalledWith('new')
    })

    it('shows the cover placeholder when the starred pick is not loaded', async () => {
      renderDialog()
      fireEvent.click(await screen.findByText('pick with unloaded'))
      fireEvent.click(
        screen.getByRole('button', { name: 'Set photo 4 of 4 as cover' })
      )

      // The picker's cover is another photo: it must not stand in for the
      // unloaded starred pick.
      const cover = screen.getByRole('group', { name: 'Cover' })
      expect(within(cover).queryByRole('img')).not.toBeInTheDocument()
    })

    it('labels the submit button with the singular photo', async () => {
      renderDialog({ intent: 'add', album: buildAlbumCard('a1') })

      fireEvent.click(await screen.findByText('pick one'))
      const submit = screen.getByRole('button', { name: /Add 1/ })
      expect(within(submit).getByText('Add 1 photo')).toBeInTheDocument()
    })
  })

  describe('album cap', () => {
    it('blocks creating an album from a selection over the cap until the overflow is removed', async () => {
      const ids = Array.from(
        { length: 2001 },
        (_, index) => `item-${index + 1}`
      )
      const items = ids.map((id, index) => namedItem(id, `Photo ${index + 1}`))
      create.mockResolvedValue(result('new', { added: ids.slice(0, 2000) }))
      // In this test file, GALLERY_ALBUM_ITEMS_BATCH is mocked to 2, so the
      // create path adds the rest in batches.
      add.mockResolvedValue(result('new', { added: ids.slice(2) }))
      const { onSaved } = renderDialog({
        initialMediaIds: ids,
        initialItems: items
      })

      expect(
        screen.getByText(
          'Albums hold up to 2,000 photos. Remove 1 to continue.'
        )
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Create album' })
      ).toBeDisabled()

      // The strip's ✕ reduces the selection to the cap.
      const strip = await screen.findByTestId('album-picks-strip')
      fireEvent.click(
        within(strip).getAllByRole('button', {
          name: /^Remove /
        })[0]
      )
      expect(
        screen.queryByText(/Remove \d+ to continue/)
      ).not.toBeInTheDocument()
      const submit = screen.getByRole('button', { name: 'Create album' })
      expect(submit).toBeEnabled()

      fireEvent.change(screen.getByLabelText('Title'), {
        target: { value: 'Big' }
      })
      fireEvent.click(submit)
      await waitFor(() => expect(onSaved).toHaveBeenCalledWith('new'))
      // In this test file, GALLERY_ALBUM_ITEMS_BATCH is mocked to 2: the
      // create takes the first batch and the rest is added in batches.
      expect(create.mock.calls[0][0].mediaIds).toEqual(['item-1', 'item-2'])
      // The removed overflow photo never reaches the album.
      expect(add.mock.calls[0][1]).toHaveLength(1998)
      expect(add.mock.calls[0][1]).not.toContain('item-1997')
      expect(add.mock.calls[0][1]).toContain('item-2001')
    })

    it('blocks adding more photos than the album has room for', async () => {
      const { onSaved } = renderDialog({
        intent: 'add',
        album: buildAlbumCard('a1', { itemCount: 1999 }),
        storedItemCount: 1999
      })

      fireEvent.click(await screen.findByText('pick three'))
      expect(
        screen.getByText(
          'Albums hold up to 2,000 photos. Remove 2 to continue.'
        )
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /Add 3 photos/ })
      ).toBeDisabled()

      const strip = await screen.findByTestId('album-picks-strip')
      fireEvent.click(
        within(strip).getAllByRole('button', { name: /^Remove / })[0]
      )
      expect(
        screen.getByText(
          'Albums hold up to 2,000 photos. Remove 1 to continue.'
        )
      ).toBeInTheDocument()
      fireEvent.click(
        within(strip).getAllByRole('button', { name: /^Remove / })[0]
      )
      expect(
        screen.queryByText(/Remove \d+ to continue/)
      ).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Add 1 photo/ })).toBeEnabled()
      expect(onSaved).not.toHaveBeenCalled()
      expect(add).not.toHaveBeenCalled()
    })
  })
})
