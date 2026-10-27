/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  act,
  createEvent,
  fireEvent,
  render,
  screen
} from '@testing-library/react'

import { buildGalleryItem } from '@/lib/components/gallery/__fixtures__/galleryItems'
import type { Attachment } from '@/lib/types/domain/attachment'

import { GalleryGrid } from './GalleryGrid'

vi.mock('@/lib/components/posts/media', () => ({
  Media: ({
    attachment,
    loading,
    revealImmediately
  }: {
    attachment?: Attachment
    loading?: 'lazy' | 'eager'
    revealImmediately?: boolean
  }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={attachment?.url}
      alt=""
      loading={loading}
      data-reveal={revealImmediately ? 'true' : undefined}
    />
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
  it('keeps every tile lazy unless the first is prioritized', () => {
    const items = [buildGalleryItem('a'), buildGalleryItem('b')]
    const { container, rerender } = render(<GalleryGrid items={items} />)
    expect(container.querySelector('[data-reveal]')).toBeNull()
    expect(
      Array.from(container.querySelectorAll('img')).map((i) =>
        i.getAttribute('loading')
      )
    ).toEqual(['lazy', 'lazy'])

    rerender(<GalleryGrid items={items} prioritizeFirst />)
    const images = Array.from(container.querySelectorAll('img'))
    expect(images.map((i) => i.getAttribute('loading'))).toEqual([
      'eager',
      'lazy'
    ])
    expect(container.querySelector('[fetchpriority]')).toBeNull()
    expect(images.map((i) => i.getAttribute('data-reveal'))).toEqual([
      'true',
      null
    ])
  })

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

  it('renders tile buttons with cursor-pointer in both default and selection modes', () => {
    const { rerender } = render(<GalleryGrid items={items} />)
    expect(screen.getByRole('button', { name: 'Open media 2' })).toHaveClass(
      'cursor-pointer'
    )

    rerender(
      <GalleryGrid
        items={items}
        selection={{ selected: new Set(), onToggle: vi.fn() }}
      />
    )
    expect(screen.getByRole('button', { name: 'Select media 2' })).toHaveClass(
      'cursor-pointer'
    )
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

    it('passes Post… and Delete from Edit details to the page, closing the viewer on a delete', async () => {
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
      await screen.findByRole('dialog', { name: 'Edit details' })

      act(() => editorProps.current?.onPost?.(['4']))
      expect(onPostItems).toHaveBeenCalledWith(['4'])

      act(() => editorProps.current?.onDeleted?.(['4']))
      expect(onItemsDeleted).toHaveBeenCalledWith(['4'])
      expect(
        screen.queryByRole('dialog', { name: 'Media viewer' })
      ).not.toBeInTheDocument()
    })

    it('offers neither action unless the page handles them', async () => {
      render(<GalleryGrid items={[unposted]} albumsOwnerId="owner-1" />)
      fireEvent.click(screen.getByRole('button', { name: /^Open media/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
      await screen.findByRole('dialog', { name: 'Edit details' })

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

    it('opens Edit details over the viewer for the photo on screen alone', async () => {
      render(<GalleryGrid items={items} albumsOwnerId="owner-1" />)
      fireEvent.click(screen.getByRole('button', { name: 'Open media 2' }))
      expect(
        screen.queryByRole('dialog', { name: 'Edit details' })
      ).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

      await screen.findByRole('dialog', { name: 'Edit details' })
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

    it('shows the saved details on the tile and in the viewer, and tells the page', async () => {
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
      await screen.findByRole('dialog', { name: 'Edit details' })

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

      expect(onToggle).toHaveBeenCalledWith(items[1], { shiftKey: false })
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

  describe('day groups', () => {
    const dayItems = [
      buildGalleryItem('1', {
        takenAt: '2025-10-04T09:30:00.000Z',
        subject: {
          name: 'Red Fox',
          scientificName: null,
          category: 'mammal',
          taxonKey: null,
          taxonPath: null
        }
      }),
      buildGalleryItem('2', { takenAt: '2025-10-04T10:30:00.000Z' }),
      buildGalleryItem('3', { takenAt: '2025-10-03T09:30:00.000Z' })
    ]
    const groups = [
      {
        key: '2025-10-04',
        header: <h2>Sat 4 Oct 2025</h2>,
        items: [dayItems[0], dayItems[1]]
      },
      {
        key: '2025-10-03',
        header: <h2>Fri 3 Oct 2025</h2>,
        items: [dayItems[2]]
      }
    ]
    const flatItems = groups.flatMap((group) => group.items)

    it('renders one section per group, header then tiles, in order', () => {
      const { container } = render(
        <GalleryGrid items={flatItems} groups={groups} />
      )

      expect(container.querySelectorAll('section')).toHaveLength(2)
      expect(
        screen.getByRole('heading', { name: 'Sat 4 Oct 2025' })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('heading', { name: 'Fri 3 Oct 2025' })
      ).toBeInTheDocument()
      // The tiles keep their flat order across the groups, and each group
      // carries its own grid.
      expect(
        screen
          .getAllByRole('button')
          .map((button) => button.getAttribute('aria-label'))
      ).toEqual([
        'Open media: Red Fox, taken 4 Oct 2025',
        'Open media 2, taken 4 Oct 2025',
        'Open media 3, taken 3 Oct 2025'
      ])
      const lists = container.querySelectorAll('ul[data-grid]')
      expect(lists).toHaveLength(2)
      expect(lists[0].querySelectorAll('li')).toHaveLength(2)
      expect(lists[1].querySelectorAll('li')).toHaveLength(1)
    })

    it('drops the date from the caption only when grouped', () => {
      const { container, rerender } = render(
        <GalleryGrid items={flatItems} groups={groups} showCaption />
      )
      const captions = () =>
        Array.from(container.querySelectorAll('li > p')).map(
          (caption) => caption.textContent
        )
      expect(captions()).toEqual(['Red Fox'])

      rerender(<GalleryGrid items={flatItems} showCaption />)
      expect(captions()).toEqual([
        'Red Fox · 4 Oct 2025',
        '4 Oct 2025',
        '3 Oct 2025'
      ])
    })

    it('keeps the date in the accessible name of a grouped tile', () => {
      render(<GalleryGrid items={flatItems} groups={groups} />)

      expect(
        screen.getByRole('button', {
          name: 'Open media: Red Fox, taken 4 Oct 2025'
        })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Open media 3, taken 3 Oct 2025' })
      ).toBeInTheDocument()
    })

    it('scrolls a grouped tile clear of the sticky header stack on phones', () => {
      render(<GalleryGrid items={flatItems} groups={groups} />)

      const tile = screen.getByRole('button', {
        name: 'Open media: Red Fox, taken 4 Oct 2025'
      })
      expect(tile).toHaveClass(
        'max-md:scroll-mt-[calc(56px+env(safe-area-inset-top,0px)+var(--status-strip-h,0px)+3rem)]'
      )
      // Phones clear the taller two-row selecting day header.
      expect(tile).toHaveClass(
        'max-sm:scroll-mt-[calc(56px+env(safe-area-inset-top,0px)+var(--status-strip-h,0px)+5rem)]'
      )
      expect(tile).toHaveClass('md:scroll-mt-[calc(79px+3rem)]')
      expect(tile).not.toHaveClass('scroll-mt-12')
    })

    it('opens the viewer at the flat index of a tile in the second group', () => {
      render(<GalleryGrid items={flatItems} groups={groups} />)

      fireEvent.click(
        screen.getByRole('button', { name: 'Open media 3, taken 3 Oct 2025' })
      )

      expect(screen.getByTestId('modal-ids')).toHaveTextContent('1,2,3')
      expect(screen.getByTestId('modal-selection')).toHaveTextContent('2')
    })

    it('shows an owner edit on a grouped tile', () => {
      render(
        <GalleryGrid
          items={flatItems}
          groups={groups}
          albumsOwnerId="owner-1"
        />
      )
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Open media: Red Fox, taken 4 Oct 2025'
        })
      )
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

      const saved = buildGalleryItem('1', {
        takenAt: '2025-10-04T09:30:00.000Z'
      })
      saved.attachment.name = 'A new alt text'
      act(() => editorProps.current?.onSaved([saved]))
      act(() => editorProps.current?.onClose())
      fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }))

      expect(
        screen.getByRole('button', {
          name: 'Open media: A new alt text, taken 4 Oct 2025'
        })
      ).toBeInTheDocument()
    })

    it('leaves the markup unchanged without groups', () => {
      const { container } = render(<GalleryGrid items={items} />)

      expect(container.querySelector('section')).toBeNull()
      expect(container.querySelectorAll('ul')).toHaveLength(1)
      expect(container.querySelector('ul')).not.toHaveAttribute('data-grid')
      expect(container.querySelector('[data-grid-index]')).toBeNull()
      expect(
        screen.getByRole('button', { name: 'Open media 2' })
      ).not.toHaveAttribute('tabindex')
    })

    describe('in select mode', () => {
      const selection = () => ({
        selected: new Set<string>(),
        onToggle: vi.fn()
      })

      it('gives the grid one roving tab stop and moves it with the arrows', () => {
        const { container } = render(
          <GalleryGrid
            items={flatItems}
            groups={groups}
            selection={selection()}
          />
        )

        const tiles = Array.from(
          container.querySelectorAll<HTMLButtonElement>('[data-grid-index]')
        )
        expect(tiles.map((tile) => tile.tabIndex)).toEqual([0, -1, -1])

        // Across the group boundary: the flat index, not the row, moves.
        fireEvent.keyDown(tiles[1], { key: 'ArrowRight' })
        expect(tiles[2]).toHaveFocus()
        expect(tiles.map((tile) => tile.tabIndex)).toEqual([-1, -1, 0])

        fireEvent.keyDown(tiles[2], { key: 'ArrowLeft' })
        expect(tiles[1]).toHaveFocus()
      })

      it('passes Shift through a click and a Shift+Space key press', () => {
        const onToggle = vi.fn()
        render(
          <GalleryGrid
            items={flatItems}
            groups={groups}
            selection={{ selected: new Set(), onToggle }}
          />
        )
        const tile = screen.getByRole('button', {
          name: 'Select media 2, taken 4 Oct 2025'
        })

        fireEvent.click(tile, { shiftKey: true })
        expect(onToggle).toHaveBeenLastCalledWith(dayItems[1], {
          shiftKey: true
        })

        fireEvent.keyDown(tile, { key: ' ', shiftKey: true })
        expect(onToggle).toHaveBeenLastCalledWith(dayItems[1], {
          shiftKey: true
        })
        fireEvent.keyDown(tile, { key: ' ', shiftKey: false })
        expect(onToggle).toHaveBeenLastCalledWith(dayItems[1], {
          shiftKey: false
        })
        expect(onToggle).toHaveBeenCalledTimes(3)
      })

      it.each([false, true])(
        'ignores repeated Space and cancels native keyup click (shift=%s)',
        (shiftKey) => {
          const onToggle = vi.fn()
          render(
            <GalleryGrid
              items={flatItems}
              groups={groups}
              selection={{ selected: new Set(), onToggle }}
            />
          )
          const tile = screen.getByRole('button', {
            name: 'Select media 2, taken 4 Oct 2025'
          })

          fireEvent.keyDown(tile, { key: ' ', shiftKey, repeat: false })
          fireEvent.keyDown(tile, { key: ' ', shiftKey, repeat: true })
          const keyUp = createEvent.keyUp(tile, { key: ' ', shiftKey })
          fireEvent(tile, keyUp)

          expect(keyUp.defaultPrevented).toBe(true)
          expect(onToggle).toHaveBeenCalledTimes(1)
          expect(onToggle).toHaveBeenCalledWith(dayItems[1], { shiftKey })
        }
      )

      it('draws the anchor ring on the anchor tile, and the pick ring on a picked one', () => {
        render(
          <GalleryGrid
            items={flatItems}
            groups={groups}
            selection={{
              selected: new Set(['1']),
              onToggle: vi.fn(),
              anchorId: '2'
            }}
          />
        )

        const anchor = screen.getByRole('button', {
          name: 'Select media 2, taken 4 Oct 2025'
        })
        expect(anchor).toHaveClass(
          'ring-2 ring-foreground ring-offset-2 ring-offset-background'
        )
        expect(anchor).not.toHaveClass('inset-ring-primary')
        const picked = screen.getByRole('button', {
          name: 'Select media: Red Fox, taken 4 Oct 2025'
        })
        expect(picked).toHaveClass('inset-ring-primary inset-ring-3')
        expect(picked).not.toHaveClass('ring-foreground')
      })

      it('draws the anchor ring on a selected anchor too, around the pick ring', () => {
        render(
          <GalleryGrid
            items={flatItems}
            groups={groups}
            selection={{
              selected: new Set(['2']),
              onToggle: vi.fn(),
              anchorId: '2'
            }}
          />
        )

        const anchor = screen.getByRole('button', {
          name: 'Select media 2, taken 4 Oct 2025'
        })
        expect(anchor).toHaveClass('inset-ring-primary inset-ring-3')
        expect(anchor).toHaveClass(
          'ring-2 ring-foreground ring-offset-2 ring-offset-background'
        )
      })

      it('draws a dashed focus outline further out than the anchor ring on a select tile, and inside a viewer tile', () => {
        const { rerender } = render(
          <GalleryGrid
            items={flatItems}
            groups={groups}
            selection={{ selected: new Set(['1']), onToggle: vi.fn() }}
          />
        )

        // The pick ring is the inset primary band; the focus outline must be
        // distinct from it and from the anchor's solid offset ring, so it is
        // a dashed outline further out in the foreground.
        const picked = screen.getByRole('button', {
          name: 'Select media: Red Fox, taken 4 Oct 2025'
        })
        expect(picked).toHaveClass(
          'focus-visible:outline-foreground',
          'focus-visible:outline-dashed',
          'focus-visible:outline-2',
          'focus-visible:outline-offset-4'
        )
        expect(picked).not.toHaveClass('focus-visible:outline-primary')
        expect(picked).not.toHaveClass('focus-visible:-outline-offset-2')
        expect(picked).not.toHaveClass('focus-visible:outline-offset-2')

        rerender(<GalleryGrid items={flatItems} groups={groups} />)
        const viewerTile = screen.getByRole('button', {
          name: 'Open media: Red Fox, taken 4 Oct 2025'
        })
        expect(viewerTile).toHaveClass(
          'focus-visible:outline-primary',
          'focus-visible:outline-2',
          'focus-visible:-outline-offset-2'
        )
        expect(viewerTile).not.toHaveClass('focus-visible:outline-foreground')
        expect(viewerTile).not.toHaveClass('focus-visible:outline-offset-2')
      })
    })
  })
})
