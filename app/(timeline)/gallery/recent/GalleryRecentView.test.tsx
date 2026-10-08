/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { getGalleryMedia } from '@/lib/client'
import { buildGalleryItem } from '@/lib/components/gallery/__fixtures__/galleryItems'

import { GalleryRecentView } from './GalleryRecentView'

vi.mock('@/lib/client', () => ({
  getGalleryMedia: vi.fn()
}))

vi.mock('@/lib/components/gallery/GalleryGrid', () => ({
  GalleryGrid: ({ items }: { items: { mediaId: string }[] }) => (
    <ul data-testid="grid">
      {items.map((item) => (
        <li key={item.mediaId}>{item.mediaId}</li>
      ))}
    </ul>
  )
}))

const getGalleryMediaMock = getGalleryMedia as jest.Mock

describe('GalleryRecentView', () => {
  beforeEach(() => {
    getGalleryMediaMock.mockReset()
  })

  it('renders the server page without fetching', () => {
    render(
      <GalleryRecentView
        actorId="actor-1"
        initialCategory={null}
        initialPage={{ items: [buildGalleryItem('5')], nextMaxId: null }}
      />
    )
    expect(screen.getByTestId('grid')).toHaveTextContent('5')
    expect(getGalleryMediaMock).not.toHaveBeenCalled()
  })

  it('starts on the category from the URL', () => {
    render(
      <GalleryRecentView
        actorId="actor-1"
        initialCategory="bird"
        initialPage={{ items: [buildGalleryItem('5')], nextMaxId: null }}
      />
    )
    expect(
      screen.getByRole('navigation', { name: 'Category' })
    ).toHaveTextContent('Birds')
  })

  it('reloads from the first page when the category changes', async () => {
    getGalleryMediaMock.mockResolvedValue({
      items: [buildGalleryItem('8')],
      nextMaxId: null
    })
    render(
      <GalleryRecentView
        actorId="actor-1"
        initialCategory={null}
        initialPage={{ items: [buildGalleryItem('5')], nextMaxId: null }}
      />
    )

    const nav = screen.getByRole('navigation', { name: 'Category' })
    fireEvent.keyDown(nav.querySelector('button')!, { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Mammals' }))

    await waitFor(() =>
      expect(screen.getByTestId('grid')).toHaveTextContent('8')
    )
    expect(screen.getByTestId('grid')).not.toHaveTextContent('5')
    expect(getGalleryMediaMock).toHaveBeenCalledWith('actor-1', {
      limit: 30,
      maxId: undefined,
      subject: undefined,
      category: 'mammal'
    })
  })
})
