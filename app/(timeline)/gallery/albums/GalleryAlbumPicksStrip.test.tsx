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

import { buildGalleryItem } from '@/lib/components/gallery/__fixtures__/galleryItems'
import type { GalleryItemEntity } from '@/lib/services/gallery/galleryEntities'

import {
  GalleryAlbumPicksStrip,
  MAX_STRIP_THUMBS
} from './GalleryAlbumPicksStrip'

// The sheet has its own tests: here it only reports that it opened.
vi.mock('@/app/(timeline)/gallery/albums/GalleryAlbumPicksSheet', () => ({
  GalleryAlbumPicksSheet: ({
    open,
    onOpenChange,
    selected,
    onSetCover
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    selected: string[]
    onSetCover: (id: string) => void
  }) => (
    <div data-testid="picks-sheet-stub">
      <span>{open ? 'open' : 'closed'}</span>
      {selected.map((id) => (
        <button
          type="button"
          key={id}
          onClick={() => onSetCover(id)}
          aria-label={`Set ${id} as cover`}
        >
          ☆
        </button>
      ))}
      <button type="button" onClick={() => onOpenChange(false)}>
        stub done
      </button>
    </div>
  )
}))

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

const renderStrip = (
  props: Partial<Parameters<typeof GalleryAlbumPicksStrip>[0]> = {}
) => {
  const onRemove = vi.fn()
  const onSetCover = vi.fn()
  const onClear = vi.fn()
  render(
    <GalleryAlbumPicksStrip
      selected={ids(3)}
      items={items(['Kingfisher', 'Heron', 'Egret'])}
      starId={null}
      intent="add"
      room={10}
      onRemove={onRemove}
      onSetCover={onSetCover}
      onClear={onClear}
      {...props}
    />
  )
  return { onRemove, onSetCover, onClear }
}

describe('GalleryAlbumPicksStrip', () => {
  it('reads the create line with the album maximum', () => {
    renderStrip({ intent: 'create' })
    const desktop = within(screen.getByTestId('album-picks-desktop'))
    expect(
      desktop.getByText('3 selected · max 2,000 per album')
    ).toBeInTheDocument()
  })

  it('reads the add line with the room left', () => {
    renderStrip({ room: 1957, selected: ids(5) })
    const desktop = within(screen.getByTestId('album-picks-desktop'))
    expect(
      desktop.getByText('5 selected · room for 1,957 more')
    ).toBeInTheDocument()
  })

  it('reads album full at zero room', () => {
    renderStrip({ room: 0, selected: ids(2) })
    const desktop = within(screen.getByTestId('album-picks-desktop'))
    expect(desktop.getByText('2 selected · album full')).toBeInTheDocument()
  })

  it('counts the picks politely', () => {
    renderStrip()
    const desktop = within(screen.getByTestId('album-picks-desktop'))
    expect(desktop.getByRole('status')).toHaveTextContent('3 selected')
  })

  it('clears the selection from the Clear button', () => {
    const { onClear } = renderStrip()
    const clear = screen.getByRole('button', { name: 'Clear' })
    expect(clear).toHaveClass('pointer-coarse:h-11')
    fireEvent.click(clear)
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('disables Clear at zero picks', () => {
    renderStrip({ selected: [] })
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled()
  })

  it('shows the last five picks and a button to open the overflow picks', () => {
    renderStrip({
      selected: ids(7),
      items: items([
        'Kingfisher',
        'Heron',
        'Egret',
        'Ibis',
        'Stork',
        'Owl',
        'Kite'
      ])
    })
    const desktop = within(screen.getByTestId('album-picks-desktop'))
    expect(desktop.getByText('+2')).toBeInTheDocument()
    expect(
      desktop.getByRole('button', { name: 'Show all 7 picks' })
    ).toHaveClass('pointer-coarse:min-h-11', 'pointer-coarse:min-w-11')
    // The first two picks are folded into the pill; the last five show.
    expect(
      desktop.queryByRole('button', {
        name: 'Remove Kingfisher, photo 1 of 7 from selection'
      })
    ).not.toBeInTheDocument()
    expect(
      desktop.queryByRole('button', {
        name: 'Remove Heron, photo 2 of 7 from selection'
      })
    ).not.toBeInTheDocument()
    expect(
      desktop.getByRole('button', {
        name: 'Remove Egret, photo 3 of 7 from selection'
      })
    ).toBeInTheDocument()
    expect(
      desktop.getByRole('button', {
        name: 'Remove Kite, photo 7 of 7 from selection'
      })
    ).toBeInTheDocument()
  })

  it('keeps every pick when there are five or fewer', () => {
    renderStrip({ selected: ids(MAX_STRIP_THUMBS) })
    const desktop = within(screen.getByTestId('album-picks-desktop'))
    expect(desktop.queryByText(/^\+/)).not.toBeInTheDocument()
    expect(
      desktop.getByRole('button', {
        name: 'Remove Kingfisher, photo 1 of 5 from selection'
      })
    ).toBeInTheDocument()
  })

  it('removes the pick from its ✕ button', () => {
    const { onRemove } = renderStrip()
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Remove Heron, photo 2 of 3 from selection'
      })
    )
    expect(onRemove).toHaveBeenCalledWith('p2')
  })

  it('stars exactly one pick and moves the star with ☆', () => {
    const { onSetCover } = renderStrip({ starId: 'p2' })
    const desktop = within(screen.getByTestId('album-picks-desktop'))
    const starred = desktop.getByRole('button', {
      name: 'Heron, photo 2 of 3, is the cover'
    })
    expect(starred).toHaveAttribute('aria-pressed', 'true')
    expect(
      desktop.getByRole('button', {
        name: 'Set Kingfisher, photo 1 of 3, as cover'
      })
    ).toHaveAttribute('aria-pressed', 'false')

    // Clicking the starred ★ again does not unset it.
    fireEvent.click(starred)
    expect(onSetCover).not.toHaveBeenCalled()

    fireEvent.click(
      desktop.getByRole('button', {
        name: 'Set Egret, photo 3 of 3, as cover'
      })
    )
    expect(onSetCover).toHaveBeenCalledWith('p3')
  })

  it('draws a placeholder for a pick it has no photo for', () => {
    renderStrip({ selected: ['unknown'], items: new Map() })
    const desktop = within(screen.getByTestId('album-picks-desktop'))
    expect(
      desktop.getByRole('button', {
        name: 'Remove photo 1 of 1 from selection'
      })
    ).toBeInTheDocument()
    expect(
      desktop.getByRole('button', { name: 'Set photo 1 of 1 as cover' })
    ).toBeInTheDocument()
    expect(desktop.queryByRole('img')).not.toBeInTheDocument()
  })

  it('folds to one phone line that opens the sheet', async () => {
    renderStrip({ room: 1957, selected: ids(5) })
    const phone = within(screen.getByTestId('album-picks-phone'))
    expect(phone.getByText('5 selected · Show')).toBeInTheDocument()
    expect(screen.getByTestId('album-picks-phone')).toHaveClass(
      'pointer-coarse:min-h-11'
    )

    fireEvent.click(screen.getByTestId('album-picks-phone'))
    const sheet = await screen.findByTestId('picks-sheet-stub')
    expect(sheet).toHaveTextContent('open')

    fireEvent.click(within(sheet).getByRole('button', { name: 'stub done' }))
    await waitFor(() => {
      expect(screen.getByTestId('picks-sheet-stub')).toHaveTextContent('closed')
    })
  })

  it('opens all picks from the desktop overflow and stars a hidden pick', async () => {
    const { onSetCover } = renderStrip({
      selected: ids(7),
      items: items([
        'Kingfisher',
        'Heron',
        'Egret',
        'Ibis',
        'Stork',
        'Owl',
        'Kite'
      ])
    })
    const desktop = within(screen.getByTestId('album-picks-desktop'))

    fireEvent.click(desktop.getByRole('button', { name: 'Show all 7 picks' }))
    const sheet = await screen.findByTestId('picks-sheet-stub')
    expect(sheet).toHaveTextContent('open')
    fireEvent.click(
      within(sheet).getByRole('button', { name: 'Set p1 as cover' })
    )
    expect(onSetCover).toHaveBeenCalledWith('p1')
  })
})
