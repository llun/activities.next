/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { GalleryAlbumsView } from '@/app/(timeline)/gallery/albums/GalleryAlbumsView'
import { getGalleryAlbumSuggestions } from '@/lib/client'
import { buildSuggestion } from '@/lib/components/gallery/__fixtures__/galleryAlbumSuggestions'
import { buildAlbumCard } from '@/lib/components/gallery/__fixtures__/galleryAlbums'
import type { GalleryAlbumSuggestionEntity } from '@/lib/services/gallery/galleryAlbumSuggestionEntities'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() })
}))

vi.mock('@/lib/client', () => ({
  getGalleryAlbumSuggestions: vi.fn()
}))

vi.mock('@/app/(timeline)/gallery/albums/GalleryAlbumFormDialog', () => ({
  GalleryAlbumFormDialog: ({
    initialTab,
    suggestions
  }: {
    initialTab: string
    suggestions: { state: { status: string } }
  }) => (
    <div role="dialog" aria-label="dialog">
      <span data-testid="initial-tab">{initialTab}</span>
      <span data-testid="suggestions-state">{suggestions.state.status}</span>
    </div>
  )
}))

const suggestionsRead = vi.mocked(getGalleryAlbumSuggestions)

const answer = (suggestions: GalleryAlbumSuggestionEntity[]) =>
  suggestionsRead.mockResolvedValue({ suggestions })

const albums = [buildAlbumCard('a1', { title: 'Kruger, September' })]
const two = [
  buildSuggestion('trip:2026-09-12'),
  buildSuggestion('species:sci:alcedo atthis', { kind: 'species' })
]

const renderView = (
  data = { albums, photoCount: 3 } as Parameters<
    typeof GalleryAlbumsView
  >[0]['data']
) => render(<GalleryAlbumsView ownerId="owner" data={data} />)

describe('GalleryAlbumsView suggestions', () => {
  beforeEach(() => {
    suggestionsRead.mockReset()
  })

  it('counts the suggestions in the stats and offers the chip', async () => {
    answer(two)
    renderView()

    const chip = await screen.findByRole('button', {
      name: '2 suggested albums'
    })
    expect(chip).toBeInTheDocument()
    expect(screen.getByText('Suggested').closest('dl')).toHaveTextContent('2')
  })

  it('says "1 suggested album" for one', async () => {
    answer([two[0]])
    renderView()

    expect(
      await screen.findByRole('button', { name: '1 suggested album' })
    ).toBeInTheDocument()
  })

  it('shows a dash for the stat while loading, with no chip', () => {
    suggestionsRead.mockReturnValue(new Promise(() => {}))
    renderView()

    expect(screen.getByText('Suggested').closest('dl')).toHaveTextContent('–')
    expect(screen.queryByText(/suggested album/)).not.toBeInTheDocument()
    // A placeholder holds the chip's place, hidden from assistive technology.
    const placeholder = document.querySelector('.skeleton')
    expect(placeholder).toHaveAttribute('aria-hidden', 'true')
  })

  it('removes the placeholder when there is nothing to suggest', async () => {
    answer([])
    renderView()

    await waitFor(() => expect(document.querySelector('.skeleton')).toBeNull())
  })

  it('hides the chip and shows 0 when there is nothing to suggest', async () => {
    answer([])
    renderView()

    await waitFor(() =>
      expect(screen.getByText('Suggested').closest('dl')).toHaveTextContent('0')
    )
    expect(screen.queryByText(/suggested album/)).not.toBeInTheDocument()
  })

  it('keeps the page working when suggestions fail', async () => {
    suggestionsRead.mockRejectedValue(new Error('Too many requests'))
    renderView()

    await waitFor(() => expect(suggestionsRead).toHaveBeenCalled())
    expect(screen.getByText('Suggested').closest('dl')).toHaveTextContent('–')
    expect(screen.queryByText(/suggested album/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Kruger/ })).toBeInTheDocument()
  })

  it('opens the create dialog on the Suggestions tab from the chip', async () => {
    answer(two)
    renderView()

    fireEvent.click(
      await screen.findByRole('button', { name: '2 suggested albums' })
    )

    expect(screen.getByTestId('initial-tab')).toHaveTextContent('suggestions')
    expect(screen.getByTestId('suggestions-state')).toHaveTextContent('ready')
  })

  it('opens the dialog on From gallery from New album', async () => {
    answer(two)
    renderView()
    await screen.findByRole('button', { name: '2 suggested albums' })

    fireEvent.click(screen.getAllByRole('button', { name: 'New album' })[0])

    expect(screen.getByTestId('initial-tab')).toHaveTextContent('gallery')
  })

  it('offers See suggestions in the empty state', async () => {
    answer(two)
    renderView({ albums: [], photoCount: 0 })

    const button = await screen.findByRole('button', {
      name: 'See suggestions'
    })
    expect(button).toHaveClass('pointer-coarse:h-10')
    fireEvent.click(button)

    expect(screen.getByTestId('initial-tab')).toHaveTextContent('suggestions')
  })

  it('has no See suggestions button in the empty state without suggestions', async () => {
    answer([])
    renderView({ albums: [], photoCount: 0 })

    await waitFor(() => expect(suggestionsRead).toHaveBeenCalled())
    expect(
      screen.getByRole('button', { name: 'Create your first album' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'See suggestions' })
    ).not.toBeInTheDocument()
  })

  it('passes the viewer time zone to the read', async () => {
    answer([])
    renderView()

    await waitFor(() =>
      expect(suggestionsRead).toHaveBeenCalledWith({
        timeZone: expect.any(String)
      })
    )
  })
})
