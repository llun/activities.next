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
    capacity,
    existingIds,
    seedItems,
    disabled
  }: {
    seedItems?: { mediaId: string }[]
    selected: string[]
    onChange: (ids: string[]) => void
    onFirstItemChange?: (item: unknown) => void
    capacity: number
    existingIds?: string[]
    disabled?: boolean
  }) => (
    <div>
      <span data-testid="capacity">{capacity}</span>
      <span data-testid="existing">{existingIds?.join(',')}</span>
      <span data-testid="seed">
        {seedItems?.map((item) => item.mediaId).join(',')}
      </span>
      <span data-testid="picker-disabled">{String(Boolean(disabled))}</span>
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

  it('calls the secondary button Close and locks the fields once the album exists', async () => {
    create.mockResolvedValue(result('new'))
    add.mockRejectedValue(new Error('Album is full.'))
    renderDialog()
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'One' }
    })
    fireEvent.click(screen.getByText('pick three'))
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
      '0 selected · can add up to 10 more'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add to album' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Choose at least one photo.'
    )

    fireEvent.click(screen.getByText('pick three'))
    expect(screen.getByTestId('album-selection-count')).toHaveTextContent(
      '3 selected · can add up to 7 more'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add to album' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('a1'))
    expect(add).toHaveBeenCalledWith('a1', ['m1', 'm2', 'm3'])
  })

  it('passes the photos already in the album to the picker', () => {
    renderDialog({
      intent: 'add',
      album: buildAlbumCard('a1', { itemCount: 2 }),
      existingMediaIds: ['x1', 'x2']
    })
    expect(screen.getByTestId('existing')).toHaveTextContent('x1,x2')
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
      '0 selected · can add up to 0 more'
    )
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
      create.mockResolvedValue(result('new'))
      update.mockResolvedValue(buildAlbumCard('new'))
      const { onSaved } = renderDialog({ initialMediaIds: ['p1', 'p2'] })

      fireEvent.change(screen.getByLabelText('Title'), {
        target: { value: 'Pair' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Create album' }))
      await waitFor(() => expect(onSaved).toHaveBeenCalledWith('new'))

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Pair', mediaIds: ['p1', 'p2'] })
      )
    })

    it('starts again from them each time it opens, not from earlier edits', () => {
      const props = {
        ownerId: 'owner',
        intent: 'create' as const,
        initialMediaIds: ['p1'],
        onOpenChange: vi.fn(),
        onSaved: vi.fn()
      }
      const { rerender } = render(<GalleryAlbumFormDialog open {...props} />)
      fireEvent.click(screen.getByText('pick three'))
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
})
