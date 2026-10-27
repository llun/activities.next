/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { buildGalleryItem } from '@/lib/components/gallery/__fixtures__/galleryItems'
import type { GalleryItemEntity } from '@/lib/services/gallery/galleryEntities'

import { GalleryAlbumPicksSheet } from './GalleryAlbumPicksSheet'

const namedItem = (mediaId: string, name: string): GalleryItemEntity =>
  buildGalleryItem(mediaId, {
    subject: {
      name,
      scientificName: null,
      category: null,
      taxonKey: null,
      taxonPath: null
    }
  })

const items = (names: string[]) =>
  new Map(
    names.map((name, index) => {
      const item = namedItem(`p${index + 1}`, name)
      return [item.mediaId, item]
    })
  )

const ids = (count: number) =>
  Array.from({ length: count }, (_, index) => `p${index + 1}`)

const renderSheet = (
  props: Partial<Parameters<typeof GalleryAlbumPicksSheet>[0]> = {}
) => {
  const onRemove = vi.fn()
  const onSetCover = vi.fn()
  const onClear = vi.fn()
  const onOpenChange = vi.fn()
  render(
    <GalleryAlbumPicksSheet
      open
      onOpenChange={onOpenChange}
      selected={ids(3)}
      items={items(['Kingfisher', 'Heron', 'Egret'])}
      starId={null}
      intent="add"
      room={1957}
      onRemove={onRemove}
      onSetCover={onSetCover}
      onClear={onClear}
      {...props}
    />
  )
  return { onRemove, onSetCover, onClear, onOpenChange }
}

describe('GalleryAlbumPicksSheet', () => {
  it('renders the header row for the picks', () => {
    renderSheet()
    const clear = screen.getByRole('button', { name: 'Clear' })
    const done = screen.getByRole('button', { name: 'Done' })
    expect(clear).toBeInTheDocument()
    expect(clear).toHaveClass('pointer-coarse:h-11')
    expect(screen.getByText('3 selected')).toBeInTheDocument()
    expect(done).toBeInTheDocument()
    expect(done).toHaveClass('pointer-coarse:h-11')
  })

  it('reads the add footer line', () => {
    renderSheet()
    expect(
      screen.getByText('Room for 1,957 more · ★ is the cover')
    ).toBeInTheDocument()
  })

  it('reads the create footer line', () => {
    renderSheet({ intent: 'create' })
    expect(
      screen.getByText('Max 2,000 per album · ★ is the cover')
    ).toBeInTheDocument()
  })

  it('lays the picks out in a three column grid with remove and star buttons', () => {
    renderSheet({
      selected: ids(5),
      items: items(['Kingfisher', 'Heron', 'Egret', 'Ibis', 'Stork'])
    })
    const grid = screen
      .getByRole('button', {
        name: 'Remove Kingfisher, photo 1 of 5 from selection'
      })
      .closest('.grid')
    expect(grid).not.toBeNull()
    expect(grid).toHaveClass('grid-cols-3')

    for (const [index, name] of [
      'Kingfisher',
      'Heron',
      'Egret',
      'Ibis',
      'Stork'
    ].entries()) {
      const position = `photo ${index + 1} of 5`
      expect(
        screen.getByRole('button', {
          name: `Remove ${name}, ${position} from selection`
        })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', {
          name: `Set ${name}, ${position}, as cover`
        })
      ).toBeInTheDocument()
    }
  })

  it('marks the starred pick and moves the star (create)', () => {
    const { onSetCover } = renderSheet({ starId: 'p2', intent: 'create' })
    const starred = screen.getByRole('button', {
      name: 'Heron, photo 2 of 3, is the cover'
    })
    expect(starred).toHaveAttribute('aria-pressed', 'true')

    // Create always keeps exactly one star: the starred ★ does nothing.
    fireEvent.click(starred)
    expect(onSetCover).not.toHaveBeenCalled()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Set Egret, photo 3 of 3, as cover'
      })
    )
    expect(onSetCover).toHaveBeenCalledWith('p3')
  })

  it('clears the star from the starred pick in the add intent', () => {
    const { onSetCover } = renderSheet({ starId: 'p2' })
    const starred = screen.getByRole('button', {
      name: 'Heron, photo 2 of 3, is the cover'
    })
    expect(starred).toHaveAttribute('aria-pressed', 'true')

    // Add photos has no default star: the ★ is a real toggle.
    fireEvent.click(starred)
    expect(onSetCover).toHaveBeenCalledWith(null)
  })

  it('removes a pick from its ✕ button', () => {
    const { onRemove } = renderSheet()
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Remove Heron, photo 2 of 3 from selection'
      })
    )
    expect(onRemove).toHaveBeenCalledWith('p2')
  })

  it('clears the selection from the header', () => {
    const { onClear } = renderSheet()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('closes from Done', () => {
    const { onOpenChange } = renderSheet()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('draws a placeholder for a pick it has no photo for', () => {
    renderSheet({ selected: ['unknown'], items: new Map() })
    expect(
      screen.getByRole('button', {
        name: 'Remove photo 1 of 1 from selection'
      })
    ).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('renders nothing when closed', () => {
    render(
      <GalleryAlbumPicksSheet
        open={false}
        onOpenChange={vi.fn()}
        selected={ids(1)}
        items={items(['Kingfisher'])}
        starId={null}
        intent="add"
        room={10}
        onRemove={vi.fn()}
        onSetCover={vi.fn()}
        onClear={vi.fn()}
      />
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('1 selected')).not.toBeInTheDocument()
  })
})
