/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'

import { buildGalleryItem } from '@/lib/components/gallery/__fixtures__/galleryItems'
import type { Attachment } from '@/lib/types/domain/attachment'

import { GalleryGrid } from './GalleryGrid'

vi.mock('@/lib/components/posts/media', () => ({
  Media: ({ attachment }: { attachment?: Attachment }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={attachment?.url} alt="" />
  )
}))

// The callback the viewer was last given, for a write that answers after the
// viewer (and so its buttons) is gone.
const lastViewerProps = vi.hoisted(() => ({
  onAlbumsChange: null as ((albumId: string) => void) | null
}))

vi.mock('@/lib/components/medias-modal/medias-modal', () => ({
  MediasModal: ({
    medias,
    initialSelection,
    albumsOwnerId,
    onAlbumsChange,
    onEdit,
    onClosed
  }: {
    medias: Attachment[] | null
    initialSelection: number
    albumsOwnerId?: string | null
    onAlbumsChange?: (albumId: string) => void
    onEdit?: (index: number) => void
    onClosed: () => void
  }) => {
    lastViewerProps.onAlbumsChange = onAlbumsChange ?? null
    return medias ? (
      <div role="dialog" aria-label="Media viewer">
        <span data-testid="modal-ids">
          {medias.map((media) => media.mediaId).join(',')}
        </span>
        <span data-testid="modal-selection">{initialSelection}</span>
        <span data-testid="modal-owner">{albumsOwnerId ?? 'none'}</span>
        <button onClick={() => onAlbumsChange?.('a1')}>Pill added to a1</button>
        <button onClick={() => onAlbumsChange?.('a2')}>Pill added to a2</button>
        {onEdit ? (
          <button onClick={() => onEdit(initialSelection)}>Edit</button>
        ) : null}
        <button onClick={onClosed}>Close viewer</button>
      </div>
    ) : null
  }
}))

const editorProps = vi.hoisted(() => ({
  current: null as null | {
    items: { mediaId: string }[]
    initialMediaId: string
    ownerId: string
    onClose: () => void
    onSaved: (items: unknown[]) => void
    onPost?: (mediaIds: string[]) => void
    onDeleted?: (mediaIds: string[]) => void
  }
}))

vi.mock('@/lib/components/gallery/GalleryEditDetailsDialog', () => ({
  GalleryEditDetailsDialog: (
    props: NonNullable<typeof editorProps.current>
  ) => {
    editorProps.current = props
    return <div role="dialog" aria-label="Edit details" />
  }
}))

const items = [
  buildGalleryItem('1', {
    subject: {
      name: 'Red Fox',
      scientificName: null,
      category: 'mammal',
      taxonKey: null,
      taxonPath: null
    }
  }),
  buildGalleryItem('2'),
  buildGalleryItem('3')
]

describe('GalleryGrid', () => {
  it('renders one tile per item, labelled by alt text, subject or position', () => {
    const withAlt = buildGalleryItem('4')
    withAlt.attachment.name = 'A fox in the snow'
    render(<GalleryGrid items={[...items, withAlt]} />)

    expect(
      screen.getByRole('button', { name: 'Open media: Red Fox' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Open media 2' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Open media: A fox in the snow' })
    ).toBeInTheDocument()
  })

  it('shows the subject and capture date only when asked to', () => {
    const { rerender } = render(<GalleryGrid items={items} />)
    expect(screen.queryByText('Red Fox · 14 Mar 2025')).not.toBeInTheDocument()

    rerender(<GalleryGrid items={items} showCaption />)
    expect(screen.getByText('Red Fox · 14 Mar 2025')).toBeInTheDocument()
    expect(screen.getAllByText('14 Mar 2025')).toHaveLength(2)
  })

  it('opens the media modal over every item at the clicked tile and closes it', () => {
    render(<GalleryGrid items={items} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open media 3' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByTestId('modal-ids')).toHaveTextContent('1,2,3')
    expect(screen.getByTestId('modal-selection')).toHaveTextContent('2')

    fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('marks videos', () => {
    const video = buildGalleryItem('5')
    video.attachment.mediaType = 'video/mp4'
    video.attachment.url = 'https://activities.local/media/5.mp4'
    render(<GalleryGrid items={[video]} />)
    expect(
      screen.getByRole('button', { name: /^Open video/ })
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Video')).not.toBeInTheDocument()
  })

  it('hands the viewer the owner id for the albums pill, when there is one', () => {
    const { rerender } = render(<GalleryGrid items={items} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open media 2' }))
    expect(screen.getByTestId('modal-owner')).toHaveTextContent('none')
    fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }))

    rerender(<GalleryGrid items={items} albumsOwnerId="owner-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Open media 2' }))
    expect(screen.getByTestId('modal-owner')).toHaveTextContent('owner-1')
  })

  describe('hidden from the gallery', () => {
    const hidden = buildGalleryItem('4', { inGallery: false })

    it('badges a photo the owner hid and says so in the tile name', () => {
      render(
        <GalleryGrid
          items={[buildGalleryItem('3', { inGallery: true }), hidden]}
        />
      )

      expect(screen.getAllByTestId('hidden-badge')).toHaveLength(1)
      expect(
        screen.getByRole('button', {
          name: 'Open media 2, hidden from your gallery'
        })
      ).toHaveTextContent('Hidden')
      // A photo in the gallery has no badge and no state in its name.
      expect(
        screen.getByRole('button', { name: 'Open media 1' })
      ).not.toHaveTextContent('Hidden')
    })

    it('keeps the state in the name when the tile has alt text or a subject', () => {
      const withAlt = buildGalleryItem('5', { inGallery: false })
      withAlt.attachment.name = 'A fox in the snow'
      const withSubject = buildGalleryItem('6', {
        inGallery: false,
        subject: {
          name: 'Red Fox',
          scientificName: null,
          category: 'mammal',
          taxonKey: null,
          taxonPath: null
        }
      })
      render(<GalleryGrid items={[withAlt, withSubject]} />)

      expect(
        screen.getByRole('button', {
          name: 'Open media: A fox in the snow, hidden from your gallery'
        })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', {
          name: 'Open media: Red Fox, hidden from your gallery'
        })
      ).toBeInTheDocument()
    })

    it('shows nothing for a viewer, who is never told (inGallery is omitted)', () => {
      render(<GalleryGrid items={items} />)

      expect(screen.queryByTestId('hidden-badge')).not.toBeInTheDocument()
      expect(screen.queryByText('Hidden')).not.toBeInTheDocument()
    })

    it('moves the badge clear of the select mark in select mode', () => {
      render(
        <GalleryGrid
          items={[hidden]}
          selection={{ selected: new Set(), onToggle: vi.fn() }}
        />
      )

      expect(
        screen.getByRole('button', {
          name: 'Select media 1, hidden from your gallery'
        })
      ).toContainElement(screen.getByTestId('hidden-badge'))
      expect(screen.getByTestId('select-mark')).toBeInTheDocument()
    })
  })

  describe('added in Gallery and not posted yet', () => {
    const unposted = buildGalleryItem('4', { statusId: null, posted: false })

    it('badges the tile "Only you" and says so in its name', () => {
      render(
        <GalleryGrid
          items={[buildGalleryItem('3', { posted: true }), unposted]}
        />
      )

      expect(screen.getAllByTestId('only-you-badge')).toHaveLength(1)
      const tile = screen.getByRole('button', {
        name: 'Open media 2, only you can see it, not posted'
      })
      expect(tile).toHaveTextContent('Only you')
      expect(
        screen.getByRole('button', { name: 'Open media 1' })
      ).not.toHaveTextContent('Only you')
    })

    it('keeps the badge with the select mark and the hidden state', () => {
      render(
        <GalleryGrid
          items={[{ ...unposted, inGallery: false }]}
          selection={{ selected: new Set(), onToggle: vi.fn() }}
        />
      )

      expect(
        screen.getByRole('button', {
          name: 'Select media 1, only you can see it, not posted, hidden from your gallery'
        })
      ).toContainElement(screen.getByTestId('only-you-badge'))
    })

    it('shows nothing for a viewer, who never gets an unposted photo', () => {
      render(<GalleryGrid items={items} />)
      expect(screen.queryByTestId('only-you-badge')).not.toBeInTheDocument()
    })

    it('passes Post… and Delete from Edit details to the page, closing the viewer on a delete', () => {
      const onPostItems = vi.fn()
      const onItemsDeleted = vi.fn()
      render(
        <GalleryGrid
          items={[unposted]}
          albumsOwnerId="owner-1"
          onPostItems={onPostItems}
          onItemsDeleted={onItemsDeleted}
        />
      )
      fireEvent.click(screen.getByRole('button', { name: /^Open media/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

      act(() => editorProps.current?.onPost?.(['4']))
      expect(onPostItems).toHaveBeenCalledWith(['4'])

      act(() => editorProps.current?.onDeleted?.(['4']))
      expect(onItemsDeleted).toHaveBeenCalledWith(['4'])
      expect(
        screen.queryByRole('dialog', { name: 'Media viewer' })
      ).not.toBeInTheDocument()
    })

    it('offers neither action unless the page handles them', () => {
      render(<GalleryGrid items={[unposted]} albumsOwnerId="owner-1" />)
      fireEvent.click(screen.getByRole('button', { name: /^Open media/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

      expect(editorProps.current?.onPost).toBeUndefined()
      expect(editorProps.current?.onDeleted).toBeUndefined()
    })
  })

  describe('edit from the viewer', () => {
    it('offers Edit to the owner only', () => {
      const { rerender } = render(<GalleryGrid items={items} />)
      fireEvent.click(screen.getByRole('button', { name: 'Open media 2' }))
      expect(
        screen.queryByRole('button', { name: 'Edit' })
      ).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }))

      rerender(<GalleryGrid items={items} albumsOwnerId="owner-1" />)
      fireEvent.click(screen.getByRole('button', { name: 'Open media 2' }))
      expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    })

    it('opens Edit details over the viewer for the photo on screen alone', () => {
      render(<GalleryGrid items={items} albumsOwnerId="owner-1" />)
      fireEvent.click(screen.getByRole('button', { name: 'Open media 2' }))
      expect(
        screen.queryByRole('dialog', { name: 'Edit details' })
      ).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

      expect(
        screen.getByRole('dialog', { name: 'Edit details' })
      ).toBeInTheDocument()
      expect(editorProps.current?.items.map((item) => item.mediaId)).toEqual([
        '2'
      ])
      expect(editorProps.current?.initialMediaId).toBe('2')
      expect(editorProps.current?.ownerId).toBe('owner-1')
      // The viewer stays under it.
      expect(
        screen.getByRole('dialog', { name: 'Media viewer' })
      ).toBeInTheDocument()

      act(() => editorProps.current?.onClose())
      expect(
        screen.queryByRole('dialog', { name: 'Edit details' })
      ).not.toBeInTheDocument()
    })

    it('shows the saved details on the tile and in the viewer, and tells the page', () => {
      const onItemEdited = vi.fn()
      render(
        <GalleryGrid
          items={items}
          albumsOwnerId="owner-1"
          onItemEdited={onItemEdited}
        />
      )
      fireEvent.click(screen.getByRole('button', { name: 'Open media 2' }))
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

      const saved = buildGalleryItem('2', { inGallery: false })
      saved.attachment.name = 'A new alt text'
      act(() => editorProps.current?.onSaved([saved]))
      act(() => editorProps.current?.onClose())
      fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }))

      expect(onItemEdited).toHaveBeenCalledWith(saved)
      expect(
        screen.getByRole('button', {
          name: 'Open media: A new alt text, hidden from your gallery'
        })
      ).toBeInTheDocument()
    })

    it('tells the page when the viewer closes, so a moved photo can leave the list', () => {
      const onViewerClosed = vi.fn()
      render(<GalleryGrid items={items} onViewerClosed={onViewerClosed} />)
      fireEvent.click(screen.getByRole('button', { name: 'Open media 2' }))
      expect(onViewerClosed).not.toHaveBeenCalled()

      fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }))

      expect(onViewerClosed).toHaveBeenCalledTimes(1)
    })
  })

  describe('select mode', () => {
    it('toggles a tile instead of opening the viewer', () => {
      const onToggle = vi.fn()
      render(
        <GalleryGrid
          items={items}
          selection={{ selected: new Set(), onToggle }}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'Select media 2' }))

      expect(onToggle).toHaveBeenCalledWith(items[1])
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /^Open/ })
      ).not.toBeInTheDocument()
    })

    it('states which tiles are selected to assistive tech and by sight', () => {
      render(
        <GalleryGrid
          items={items}
          selection={{ selected: new Set(['2']), onToggle: vi.fn() }}
        />
      )

      const picked = screen.getByRole('button', { name: 'Select media 2' })
      const other = screen.getByRole('button', { name: 'Select media 3' })
      expect(picked).toHaveAttribute('aria-pressed', 'true')
      expect(other).toHaveAttribute('aria-pressed', 'false')
      expect(picked.querySelector('svg')).not.toBeNull()
      expect(other.querySelector('svg')).toBeNull()
      // Every tile shows its mark, so the mode is clear before the first pick.
      expect(screen.getAllByTestId('select-mark')).toHaveLength(3)
    })

    it('keeps the subject in the name of a tile', () => {
      render(
        <GalleryGrid
          items={items}
          selection={{ selected: new Set(), onToggle: vi.fn() }}
        />
      )

      expect(
        screen.getByRole('button', { name: 'Select media: Red Fox' })
      ).toBeInTheDocument()
    })

    it('has no pressed state and no marks outside select mode', () => {
      render(<GalleryGrid items={items} />)

      expect(
        screen.getByRole('button', { name: 'Open media 2' })
      ).not.toHaveAttribute('aria-pressed')
      expect(screen.queryByTestId('select-mark')).not.toBeInTheDocument()
    })
  })

  describe('albums changed from the viewer', () => {
    const openFirst = () =>
      fireEvent.click(screen.getAllByRole('button', { name: /^Open media/ })[0])

    it('tells the page which albums changed once, when the viewer closes', () => {
      const onAlbumsChanged = vi.fn()
      render(
        <GalleryGrid
          items={items}
          albumsOwnerId="owner"
          onAlbumsChanged={onAlbumsChanged}
        />
      )
      openFirst()

      fireEvent.click(screen.getByRole('button', { name: 'Pill added to a1' }))
      fireEvent.click(screen.getByRole('button', { name: 'Pill added to a2' }))
      fireEvent.click(screen.getByRole('button', { name: 'Pill added to a1' }))
      // Not under the viewer: the photo being looked at must not change.
      expect(onAlbumsChanged).not.toHaveBeenCalled()

      fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }))
      expect(onAlbumsChanged).toHaveBeenCalledTimes(1)
      expect(onAlbumsChanged).toHaveBeenCalledWith(['a1', 'a2'])
    })

    it('says nothing when nothing changed, and starts afresh the next time', () => {
      const onAlbumsChanged = vi.fn()
      render(
        <GalleryGrid
          items={items}
          albumsOwnerId="owner"
          onAlbumsChanged={onAlbumsChanged}
        />
      )
      openFirst()
      fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }))
      expect(onAlbumsChanged).not.toHaveBeenCalled()

      openFirst()
      fireEvent.click(screen.getByRole('button', { name: 'Pill added to a2' }))
      fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }))
      expect(onAlbumsChanged).toHaveBeenCalledWith(['a2'])
    })

    it('reports a change that settles after the viewer closed straight away', () => {
      const onAlbumsChanged = vi.fn()
      render(
        <GalleryGrid
          items={items}
          albumsOwnerId="owner"
          onAlbumsChanged={onAlbumsChanged}
        />
      )
      openFirst()
      // The write is still out when the viewer is closed.
      fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(onAlbumsChanged).not.toHaveBeenCalled()

      act(() => lastViewerProps.onAlbumsChange?.('a1'))

      expect(onAlbumsChanged).toHaveBeenCalledTimes(1)
      expect(onAlbumsChanged).toHaveBeenCalledWith(['a1'])

      // Nothing was left queued for the next time the viewer closes.
      openFirst()
      fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }))
      expect(onAlbumsChanged).toHaveBeenCalledTimes(1)
    })

    it('closes quietly when the page did not ask to know', () => {
      render(<GalleryGrid items={items} albumsOwnerId="owner" />)
      openFirst()
      fireEvent.click(screen.getByRole('button', { name: 'Pill added to a1' }))

      fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }))

      expect(screen.queryByTestId('modal-ids')).not.toBeInTheDocument()
    })
  })
})
