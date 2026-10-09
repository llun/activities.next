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
    onClosed
  }: {
    medias: Attachment[] | null
    initialSelection: number
    albumsOwnerId?: string | null
    onAlbumsChange?: (albumId: string) => void
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
        <button onClick={onClosed}>Close viewer</button>
      </div>
    ) : null
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
