/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { GalleryAlbumFormDialog } from '@/app/(timeline)/gallery/albums/GalleryAlbumFormDialog'
import {
  addGalleryAlbumItems,
  createGalleryAlbum,
  updateGalleryAlbum
} from '@/lib/client'
import { buildAlbumCard } from '@/lib/components/gallery/__fixtures__/galleryAlbums'
import { buildGalleryItem } from '@/lib/components/gallery/__fixtures__/galleryItems'

vi.mock('@/lib/client', () => ({
  addGalleryAlbumItems: vi.fn(),
  createGalleryAlbum: vi.fn(),
  updateGalleryAlbum: vi.fn()
}))

vi.mock('@/lib/client/galleryAlbums', () => ({
  GALLERY_ALBUM_ITEMS_BATCH: 2
}))

// The picker has its own tests: here it only reports picks.
vi.mock('@/app/(timeline)/gallery/albums/GalleryAlbumPicker', () => ({
  GalleryAlbumPicker: ({
    selected,
    onChange,
    onFirstItemChange,
    capacity
  }: {
    selected: string[]
    onChange: (ids: string[]) => void
    onFirstItemChange?: (item: unknown) => void
    capacity: number
  }) => (
    <div>
      <span data-testid="capacity">{capacity}</span>
      <button
        type="button"
        onClick={() => {
          onChange(['m1', 'm2', 'm3'])
          onFirstItemChange?.(buildGalleryItem('m1'))
        }}
      >
        pick three
      </button>
      <span data-testid="picked">{selected.join(',')}</span>
    </div>
  )
}))

const create = vi.mocked(createGalleryAlbum)
const add = vi.mocked(addGalleryAlbumItems)
const update = vi.mocked(updateGalleryAlbum)

const result = (id: string) =>
  ({ added: [], existing: [], skipped: [], album: buildAlbumCard(id) }) as never

describe('GalleryAlbumFormDialog', () => {
  beforeEach(() => {
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

  it('saves nothing until the primary button, then creates, adds the rest and sets the cover', async () => {
    create.mockResolvedValue(result('new'))
    add.mockResolvedValue(result('new'))
    update.mockResolvedValue(buildAlbumCard('new'))
    const { onSaved, onOpenChange } = renderDialog()

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: '  Kruger  ' }
    })
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: 'Eight days' }
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Private' }))
    fireEvent.click(screen.getByText('pick three'))
    expect(create).not.toHaveBeenCalled()
    expect(screen.getByTestId('album-selection-count')).toHaveTextContent(
      '3 selected · max 2,000 per album'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Create album' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('new'))

    expect(create).toHaveBeenCalledWith({
      title: 'Kruger',
      description: 'Eight days',
      visibility: 'private',
      mediaIds: ['m1', 'm2']
    })
    expect(add).toHaveBeenCalledWith('new', ['m3'])
    expect(update).toHaveBeenCalledWith('new', { coverMediaId: 'm1' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('needs a title and does not call the server without one', () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Create album' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Give the album a title.'
    )
    expect(create).not.toHaveBeenCalled()
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
    fireEvent.click(screen.getByText('pick three'))
    fireEvent.click(screen.getByRole('button', { name: 'Create album' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The album was created, but not everything was added: Album is full.'
    )
    expect(onSaved).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Open album' }))
    expect(onSaved).toHaveBeenCalledWith('new')
    expect(create).toHaveBeenCalledTimes(1)
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

    fireEvent.click(screen.getByRole('button', { name: 'Add to album' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Choose at least one photo.'
    )

    fireEvent.click(screen.getByText('pick three'))
    fireEvent.click(screen.getByRole('button', { name: 'Add to album' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('a1'))
    expect(add).toHaveBeenCalledWith('a1', ['m1', 'm2', 'm3'])
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
})
