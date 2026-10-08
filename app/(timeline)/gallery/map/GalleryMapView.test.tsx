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

import { getGalleryMap } from '@/lib/client'
import type {
  GalleryMapPoint,
  GalleryMapResponse
} from '@/lib/services/gallery/galleryEntities'
import { createDeferred } from '@/lib/testing/deferred'

import { GalleryMapView } from './GalleryMapView'

const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush })
}))
vi.mock('@/lib/client', () => ({ getGalleryMap: vi.fn() }))
// The map itself has its own tests; this view only decides which points it gets.
vi.mock('@/lib/components/gallery/GalleryMap', () => ({
  GalleryMap: ({
    points,
    onSelect
  }: {
    points: GalleryMapPoint[]
    onSelect?: (mediaId: string) => void
  }) => (
    <div data-testid="gallery-map">
      <ul>
        {points.map((point) => (
          <li key={point.mediaId}>
            {point.mediaId}
            <button type="button" onClick={() => onSelect?.(point.mediaId)}>
              open {point.mediaId}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}))

const makePoint = (
  id: string,
  overrides: Partial<GalleryMapPoint> = {}
): GalleryMapPoint => ({
  mediaId: id,
  statusId: `status-${id}`,
  latitude: 14,
  longitude: 101,
  precision: 'exact',
  publicState: 'shown-exact',
  subjectName: null,
  placeName: null,
  countryCode: null,
  thumbnailUrl: null,
  takenAt: null,
  ...overrides
})

const ownerPoints = [
  makePoint('1', { subjectName: 'Kingfisher' }),
  makePoint('2', { subjectName: 'Roller' }),
  makePoint('3', { subjectName: 'Kingfisher', publicState: 'not-shown' }),
  makePoint('4', { publicState: 'in-hidden-location' }),
  makePoint('5', { publicState: 'not-public-post' })
]

const renderView = (
  props: Partial<Parameters<typeof GalleryMapView>[0]> = {}
) =>
  render(
    <GalleryMapView
      actorId="https://example.com/users/ann"
      username="ann"
      domain="example.com"
      initialPoints={ownerPoints}
      initialTruncated={false}
      mapPublic
      mapProvider={{ type: 'osm' }}
      {...props}
    />
  )

const mapIds = () =>
  within(screen.getByTestId('gallery-map'))
    .getAllByRole('listitem')
    .map((item) => item.firstChild?.textContent)

describe('GalleryMapView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('summarises the photos with a place in the section header', () => {
    renderView()

    expect(
      screen.getByRole('heading', { level: 1, name: 'Map' })
    ).toBeInTheDocument()
    expect(
      screen.getByText('5 photos and videos with a place')
    ).toBeInTheDocument()
  })

  it('uses the singular for a single photo', () => {
    renderView({ initialPoints: [makePoint('1')] })

    expect(
      screen.getByText('1 photo or video with a place')
    ).toBeInTheDocument()
  })

  it('filters the map by subject', () => {
    renderView()

    const select = screen.getByRole('combobox', { name: 'Subject' })
    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent)
    ).toEqual(['All subjects', 'Kingfisher', 'Roller'])
    expect(mapIds()).toEqual(['1', '2', '3', '4', '5'])

    fireEvent.change(select, { target: { value: 'Kingfisher' } })

    expect(mapIds()).toEqual(['1', '3'])
    fireEvent.change(select, { target: { value: '' } })
    expect(mapIds()).toEqual(['1', '2', '3', '4', '5'])
  })

  it('counts every owner point the public map leaves out', () => {
    renderView()

    // Not-shown precision, inside a hidden location, and a non-public post.
    expect(
      screen.getByText('3 items are not shown on the public map.')
    ).toBeInTheDocument()
  })

  it('counts the header by the subject filter', () => {
    renderView()

    fireEvent.change(screen.getByRole('combobox', { name: 'Subject' }), {
      target: { value: 'Kingfisher' }
    })

    expect(
      screen.getByText('2 photos and videos with a place')
    ).toBeInTheDocument()
  })

  it('counts and names the points kept off the map for threatened species', () => {
    renderView({
      initialPoints: [
        makePoint('1'),
        makePoint('2', { publicState: 'threatened-species' }),
        makePoint('3', { publicState: 'threatened-species' }),
        makePoint('4', { publicState: 'in-hidden-location' })
      ]
    })

    expect(
      screen.getByText(
        '3 items are not shown on the public map, 2 because of threatened-species hiding.'
      )
    ).toBeInTheDocument()
  })

  it('adds the distinct countries to the header, and leaves them out when unknown', () => {
    const { unmount } = renderView({
      initialPoints: [
        makePoint('1', { countryCode: 'TH' }),
        makePoint('2', { countryCode: 'TH' }),
        makePoint('3', { countryCode: 'KE' }),
        makePoint('4')
      ]
    })
    expect(
      screen.getByText('4 photos and videos with a place · 2 countries')
    ).toBeInTheDocument()
    unmount()

    renderView({ initialPoints: [makePoint('1', { countryCode: 'TH' })] })
    expect(
      screen.getByText('1 photo or video with a place · 1 country')
    ).toBeInTheDocument()
  })

  it('counts the countries of the filtered subject only', () => {
    renderView({
      initialPoints: [
        makePoint('1', { subjectName: 'Kingfisher', countryCode: 'TH' }),
        makePoint('2', { subjectName: 'Roller', countryCode: 'KE' })
      ]
    })

    fireEvent.change(screen.getByRole('combobox', { name: 'Subject' }), {
      target: { value: 'Roller' }
    })

    expect(
      screen.getByText('1 photo or video with a place · 1 country')
    ).toBeInTheDocument()
  })

  it('says nothing about the public map when all of it is shown', () => {
    renderView({ initialPoints: [ownerPoints[0]] })

    expect(
      screen.queryByText(/not shown on the public map/)
    ).not.toBeInTheDocument()
  })

  it('notes a truncated map', () => {
    renderView({ initialTruncated: true })

    expect(
      screen.getByText('Showing the newest photos and videos only.')
    ).toBeInTheDocument()
  })

  it('opens a selected photo on its post', () => {
    renderView()

    fireEvent.click(screen.getByRole('button', { name: 'open 2' }))

    expect(mockPush).toHaveBeenCalledWith('/@ann@example.com/status-2')
  })

  describe('Preview public map', () => {
    const publicResponse: GalleryMapResponse = {
      points: [
        makePoint('1', { precision: 'area', subjectName: 'Kingfisher' })
      ],
      countryCount: null,
      truncated: false
    }

    it('swaps in what visitors get, fetched once, and back', async () => {
      vi.mocked(getGalleryMap).mockResolvedValue(publicResponse)
      renderView()

      const toggle = screen.getByRole('switch', { name: 'Preview public map' })
      expect(toggle).not.toBeChecked()
      fireEvent.click(toggle)

      await waitFor(() => expect(mapIds()).toEqual(['1']))
      expect(getGalleryMap).toHaveBeenCalledWith(
        'https://example.com/users/ann',
        {
          previewPublic: true
        }
      )
      expect(
        screen.getByText('1 photo or video with a place')
      ).toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent(
        'This is what visitors see'
      )
      expect(
        screen.queryByText(/not shown on the public map/)
      ).not.toBeInTheDocument()

      fireEvent.click(toggle)
      expect(mapIds()).toEqual(['1', '2', '3', '4', '5'])

      fireEvent.click(toggle)
      await waitFor(() => expect(mapIds()).toEqual(['1']))
      expect(getGalleryMap).toHaveBeenCalledTimes(1)
    })

    it('shows a skeleton and marks the switch busy while loading', async () => {
      const deferred = createDeferred<GalleryMapResponse | null>()
      vi.mocked(getGalleryMap).mockReturnValue(deferred.promise)
      renderView()

      const toggle = screen.getByRole('switch', { name: 'Preview public map' })
      fireEvent.click(toggle)

      expect(toggle).toHaveAttribute('aria-busy', 'true')
      expect(screen.queryByTestId('gallery-map')).not.toBeInTheDocument()

      deferred.resolve(publicResponse)
      expect(await screen.findByTestId('gallery-map')).toBeInTheDocument()
      expect(toggle).toHaveAttribute('aria-busy', 'false')
    })

    it('clears the busy state when the preview is switched off mid-request', async () => {
      const deferred = createDeferred<GalleryMapResponse | null>()
      vi.mocked(getGalleryMap).mockReturnValue(deferred.promise)
      renderView()

      const toggle = screen.getByRole('switch', { name: 'Preview public map' })
      fireEvent.click(toggle)
      expect(toggle).toHaveAttribute('aria-busy', 'true')
      fireEvent.click(toggle)

      expect(toggle).toHaveAttribute('aria-busy', 'false')
    })

    it('says the map is private when the public map is switched off', async () => {
      vi.mocked(getGalleryMap).mockResolvedValue(null)
      renderView()

      fireEvent.click(
        screen.getByRole('switch', { name: 'Preview public map' })
      )

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Your map is private'
      )
      expect(
        screen.getByRole('link', { name: 'Gallery privacy' })
      ).toHaveAttribute('href', '/gallery/privacy')
      expect(screen.queryByTestId('gallery-map')).not.toBeInTheDocument()
    })

    it('does not ask the server when the setting already says the map is private', () => {
      renderView({ mapPublic: false })

      fireEvent.click(
        screen.getByRole('switch', { name: 'Preview public map' })
      )

      expect(screen.getByRole('alert')).toHaveTextContent('Your map is private')
      expect(getGalleryMap).not.toHaveBeenCalled()
    })

    it('switches the preview back off and reports a failed load', async () => {
      vi.mocked(getGalleryMap).mockRejectedValue(new Error('boom'))
      renderView()

      const toggle = screen.getByRole('switch', { name: 'Preview public map' })
      fireEvent.click(toggle)

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Failed to load the public preview.'
      )
      expect(toggle).not.toBeChecked()
      expect(mapIds()).toEqual(['1', '2', '3', '4', '5'])
    })

    it('opens a previewed photo on the post the public projection chose', async () => {
      vi.mocked(getGalleryMap).mockResolvedValue({
        points: [makePoint('9', { statusId: 'public-status' })],
        countryCount: null,
        truncated: false
      })
      renderView()
      fireEvent.click(
        screen.getByRole('switch', { name: 'Preview public map' })
      )
      await waitFor(() => expect(mapIds()).toEqual(['9']))

      fireEvent.click(screen.getByRole('button', { name: 'open 9' }))

      expect(mockPush).toHaveBeenCalledWith('/@ann@example.com/public-status')
    })
  })
})
