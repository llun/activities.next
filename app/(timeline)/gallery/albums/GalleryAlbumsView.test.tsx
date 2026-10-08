/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'

import { GalleryAlbumsView } from '@/app/(timeline)/gallery/albums/GalleryAlbumsView'
import { buildAlbumCard } from '@/lib/components/gallery/__fixtures__/galleryAlbums'

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush })
}))

vi.mock('@/app/(timeline)/gallery/albums/GalleryAlbumFormDialog', () => ({
  GalleryAlbumFormDialog: ({
    intent,
    onSaved
  }: {
    intent: string
    onSaved: (id: string) => void
  }) => (
    <div role="dialog" aria-label={`dialog ${intent}`}>
      <button onClick={() => onSaved('new-id')}>finish</button>
    </div>
  )
}))

const albums = [
  buildAlbumCard('a1', { title: 'Kruger, September' }),
  buildAlbumCard('a2', { title: 'Berlin Marathon', visibility: 'private' }),
  buildAlbumCard('a3', {
    title: 'Garden',
    itemCount: 0,
    firstAt: null,
    lastAt: null,
    previews: [],
    cover: null
  })
]

describe('GalleryAlbumsView', () => {
  beforeEach(() => mockPush.mockReset())

  it('shows the totals, the filter counts and a card per album', () => {
    render(
      <GalleryAlbumsView ownerId="owner" data={{ albums, photoCount: 5 }} />
    )

    const stats = screen.getByText('Photos in albums').closest('dl')
    expect(stats).toHaveTextContent('5')
    expect(screen.getByRole('button', { name: /All\s*3/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(
      screen.getByRole('button', { name: /Public\s*2/ })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Private\s*1/ })
    ).toBeInTheDocument()

    const link = screen.getByRole('link', { name: /Kruger, September/ })
    expect(link).toHaveAttribute('href', '/gallery/albums/a1')
    expect(
      within(link).getByText('3 photos · 12 – 19 Sep 2026')
    ).toBeInTheDocument()
    expect(screen.getByText('0 photos')).toBeInTheDocument()
  })

  it('marks a private album with a badge and filters by visibility', () => {
    render(
      <GalleryAlbumsView ownerId="owner" data={{ albums, photoCount: 5 }} />
    )
    const berlin = screen.getByRole('link', { name: /Berlin Marathon/ })
    expect(within(berlin).getByText('Private')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Private\s*1/ }))
    expect(screen.getByRole('button', { name: /Private\s*1/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(
      screen.getByRole('link', { name: /Berlin Marathon/ })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /Kruger/ })
    ).not.toBeInTheDocument()
    // Only the header's New album remains: the dashed card is for the full list.
    expect(screen.getAllByRole('button', { name: 'New album' })).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: /Public\s*2/ }))
    expect(
      screen.queryByRole('link', { name: /Berlin Marathon/ })
    ).not.toBeInTheDocument()
  })

  it('opens the create dialog from the header and the dashed card, then opens the new album', () => {
    render(
      <GalleryAlbumsView ownerId="owner" data={{ albums, photoCount: 5 }} />
    )
    const newButtons = screen.getAllByRole('button', { name: 'New album' })
    expect(newButtons).toHaveLength(2)

    fireEvent.click(newButtons[1])
    expect(
      screen.getByRole('dialog', { name: 'dialog create' })
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'finish' }))
    expect(mockPush).toHaveBeenCalledWith('/gallery/albums/new-id')
  })

  it('shows the empty state with a way to create the first album', () => {
    render(
      <GalleryAlbumsView ownerId="owner" data={{ albums: [], photoCount: 0 }} />
    )
    expect(
      screen.getByRole('heading', { name: 'Group photos that belong together' })
    ).toBeInTheDocument()
    expect(screen.queryByText('Photos in albums')).not.toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'Create your first album' })
    )
    expect(
      screen.getByRole('dialog', { name: 'dialog create' })
    ).toBeInTheDocument()
  })
})
