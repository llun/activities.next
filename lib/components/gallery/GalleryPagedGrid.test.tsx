/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { getGalleryMedia } from '@/lib/client'
import { buildGalleryItem } from '@/lib/components/gallery/__fixtures__/galleryItems'

import { GalleryPagedGrid } from './GalleryPagedGrid'

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

describe('GalleryPagedGrid', () => {
  beforeEach(() => {
    getGalleryMediaMock.mockReset()
  })

  it('shows the server page without fetching, and pages with nextMaxId', async () => {
    getGalleryMediaMock.mockResolvedValue({
      items: [buildGalleryItem('1'), buildGalleryItem('3')],
      nextMaxId: null
    })
    render(
      <GalleryPagedGrid
        actorId="actor-1"
        subject="sci:x"
        initialPage={{
          items: [buildGalleryItem('3'), buildGalleryItem('2')],
          nextMaxId: '2'
        }}
      />
    )
    expect(getGalleryMediaMock).not.toHaveBeenCalled()
    expect(screen.getByTestId('grid')).toHaveTextContent('32')

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    await waitFor(() =>
      expect(screen.getByTestId('grid')).toHaveTextContent('321')
    )
    expect(getGalleryMediaMock).toHaveBeenCalledWith('actor-1', {
      limit: 30,
      maxId: '2',
      subject: 'sci:x',
      category: undefined
    })
    expect(
      screen.queryByRole('button', { name: 'Load more' })
    ).not.toBeInTheDocument()
  })

  it('loads its own first page when the server did not, with a skeleton meanwhile', async () => {
    let resolve: (page: unknown) => void = () => {}
    getGalleryMediaMock.mockReturnValue(
      new Promise((done) => {
        resolve = done
      })
    )
    render(<GalleryPagedGrid actorId="actor-1" category="bird" />)
    expect(screen.getByText('Loading photos')).toBeInTheDocument()

    resolve({ items: [buildGalleryItem('9')], nextMaxId: null })
    await waitFor(() =>
      expect(screen.getByTestId('grid')).toHaveTextContent('9')
    )
    expect(getGalleryMediaMock).toHaveBeenCalledWith('actor-1', {
      limit: 30,
      maxId: undefined,
      subject: undefined,
      category: 'bird'
    })
  })

  it('says so when there is nothing to show', async () => {
    getGalleryMediaMock.mockResolvedValue({ items: [], nextMaxId: null })
    render(<GalleryPagedGrid actorId="actor-1" emptyTitle="No birds yet" />)
    expect(await screen.findByText('No birds yet')).toBeInTheDocument()
  })

  it('reports a failed load and lets the user retry', async () => {
    getGalleryMediaMock.mockRejectedValueOnce(new Error('Boom'))
    render(<GalleryPagedGrid actorId="actor-1" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Boom')

    getGalleryMediaMock.mockResolvedValueOnce({
      items: [buildGalleryItem('7')],
      nextMaxId: null
    })
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() =>
      expect(screen.getByTestId('grid')).toHaveTextContent('7')
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
