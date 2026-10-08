/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'

import { createMapKitTestDouble } from '@/lib/components/fitness/mapkitTestDouble'
import type { GalleryMapPoint } from '@/lib/services/gallery/galleryEntities'
import { loadMapKitModule } from '@/lib/utils/mapkit'
import { loadMaplibreModule } from '@/lib/utils/maplibre'

import { GalleryMap } from './GalleryMap'

vi.mock('@/lib/utils/mapbox', () => ({ loadMapboxModule: vi.fn() }))
vi.mock('@/lib/utils/maplibre', () => ({
  loadMaplibreModule: vi.fn(),
  OPENFREEMAP_STYLE_URL: 'https://tiles.openfreemap.org/styles/bright',
  OPENFREEMAP_HEATMAP_STYLE_URL: 'https://tiles.openfreemap.org/styles/positron'
}))
vi.mock('@/lib/utils/mapkit', () => ({ loadMapKitModule: vi.fn() }))

const makePoint = (
  index: number,
  overrides: Partial<GalleryMapPoint> = {}
): GalleryMapPoint => ({
  mediaId: `media-${index}`,
  statusId: `status-${index}`,
  latitude: 14.4 + index * 0.1,
  longitude: 101.4 + index * 0.1,
  precision: 'exact',
  subjectName: `Subject ${index}`,
  placeName: 'Khao Yai, Thailand',
  thumbnailUrl: `https://cdn.example/thumb-${index}.jpg`,
  takenAt: `2026-10-0${index + 1}T08:00:00.000Z`,
  ...overrides
})

type GlFeature = {
  properties: Record<string, unknown>
  geometry: { coordinates: [number, number] }
}

const createFakeGl = (features: GlFeature[] = []) => {
  const handlers: Record<string, () => void> = {}
  const sourceData = { setData: vi.fn() }
  const markers: Array<{
    element: HTMLElement
    lngLat: [number, number] | null
    remove: ReturnType<typeof vi.fn>
  }> = []
  const state = { features, loaded: true, zoom: 5 }
  const map = {
    on: vi.fn((event: string, callback: () => void) => {
      handlers[event] = callback
    }),
    remove: vi.fn(),
    resize: vi.fn(),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    getSource: vi.fn(() => sourceData),
    querySourceFeatures: vi.fn(() => state.features),
    isSourceLoaded: vi.fn(() => state.loaded),
    getZoom: vi.fn(() => state.zoom),
    easeTo: vi.fn(),
    fitBounds: vi.fn()
  }
  const Map = vi.fn(function MapCtor() {
    Promise.resolve().then(() => handlers.load?.())
    return map
  })
  const Marker = vi.fn(function MarkerCtor(options: { element: HTMLElement }) {
    const marker = {
      element: options.element,
      lngLat: null as [number, number] | null,
      remove: vi.fn(),
      setLngLat(lngLat: [number, number]) {
        marker.lngLat = lngLat
        return marker
      },
      addTo() {
        return marker
      }
    }
    markers.push(marker)
    return marker
  })
  return { gl: { Map, Marker }, map, handlers, sourceData, markers, state }
}

describe('GalleryMap', () => {
  beforeEach(() => {
    vi.mocked(loadMaplibreModule).mockReset()
    vi.mocked(loadMapKitModule).mockReset()
  })

  it('shows an empty state instead of a map when no point has a place', () => {
    render(<GalleryMap points={[]} mapProvider={{ type: 'osm' }} />)

    expect(
      screen.getByText('No photos or videos with a place yet')
    ).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Gallery map' })).toBeNull()
    expect(loadMaplibreModule).not.toHaveBeenCalled()
  })

  describe('with a GL provider', () => {
    it('builds a clustered source on the outdoors style and frames the points', async () => {
      const fake = createFakeGl()
      vi.mocked(loadMaplibreModule).mockResolvedValue(fake.gl as never)
      const points = [makePoint(0), makePoint(1)]

      render(<GalleryMap points={points} mapProvider={{ type: 'osm' }} />)

      await waitFor(() => expect(fake.map.addSource).toHaveBeenCalled())
      expect(fake.gl.Map).toHaveBeenCalledWith(
        expect.objectContaining({
          style: 'https://tiles.openfreemap.org/styles/bright'
        })
      )
      const [sourceId, source] = fake.map.addSource.mock.calls[0]
      expect(source).toMatchObject({
        type: 'geojson',
        cluster: true,
        clusterProperties: { rep: ['min', ['get', 'idx']] }
      })
      expect(source.data.features).toHaveLength(2)
      expect(source.data.features[1].geometry.coordinates).toEqual([
        points[1].longitude,
        points[1].latitude
      ])
      // The invisible layer is what makes GL load the clustered source.
      expect(fake.map.addLayer).toHaveBeenCalledWith(
        expect.objectContaining({ source: sourceId, type: 'circle' })
      )
      expect(fake.map.fitBounds).toHaveBeenCalledWith(
        [
          [points[0].longitude, points[0].latitude],
          [points[1].longitude, points[1].latitude]
        ],
        expect.objectContaining({ duration: 0 })
      )
      expect(await screen.findByText('OpenFreeMap')).toBeInTheDocument()
    })

    it('draws thumbnail markers with count badges for what the source exposes', async () => {
      const points = [makePoint(0), makePoint(1), makePoint(2)]
      const fake = createFakeGl([
        {
          properties: { idx: 0 },
          geometry: { coordinates: [101.4, 14.4] }
        },
        {
          properties: { cluster: true, cluster_id: 7, point_count: 2, rep: 1 },
          geometry: { coordinates: [101.7, 14.7] }
        },
        // The same feature repeated across tile edges draws one marker.
        {
          properties: { idx: 0 },
          geometry: { coordinates: [101.4, 14.4] }
        }
      ])
      vi.mocked(loadMaplibreModule).mockResolvedValue(fake.gl as never)

      render(<GalleryMap points={points} mapProvider={{ type: 'osm' }} />)
      await screen.findByText('OpenFreeMap')
      act(() => fake.handlers.render())

      expect(fake.markers).toHaveLength(2)
      const cluster = fake.markers.find((marker) =>
        marker.element.querySelector('[data-gallery-marker-count]')
      )
      expect(cluster?.element.textContent).toBe('2')
      expect(cluster?.lngLat).toEqual([101.7, 14.7])
      // A cluster is covered by its representative (the newest member).
      expect(cluster?.element.querySelector('img')).toHaveAttribute(
        'src',
        'https://cdn.example/thumb-1.jpg'
      )
    })

    it('waits for the source before drawing markers and drops ones that left the view', async () => {
      const points = [makePoint(0), makePoint(1)]
      const fake = createFakeGl([
        { properties: { idx: 0 }, geometry: { coordinates: [101.4, 14.4] } }
      ])
      vi.mocked(loadMaplibreModule).mockResolvedValue(fake.gl as never)

      render(<GalleryMap points={points} mapProvider={{ type: 'osm' }} />)
      await screen.findByText('OpenFreeMap')

      fake.state.loaded = false
      act(() => fake.handlers.render())
      expect(fake.markers).toHaveLength(0)

      fake.state.loaded = true
      act(() => fake.handlers.render())
      expect(fake.markers).toHaveLength(1)

      fake.state.features = [
        { properties: { idx: 1 }, geometry: { coordinates: [101.5, 14.5] } }
      ]
      act(() => fake.handlers.render())
      expect(fake.markers[0].remove).toHaveBeenCalled()
      expect(fake.markers).toHaveLength(2)
    })

    it('shows the selected photo in a card and opens it through onSelect', async () => {
      const onSelect = vi.fn()
      const points = [makePoint(0), makePoint(1)]
      const fake = createFakeGl([
        { properties: { idx: 1 }, geometry: { coordinates: [101.5, 14.5] } }
      ])
      vi.mocked(loadMaplibreModule).mockResolvedValue(fake.gl as never)

      render(
        <GalleryMap
          points={points}
          mapProvider={{ type: 'osm' }}
          onSelect={onSelect}
        />
      )
      await screen.findByText('OpenFreeMap')
      act(() => fake.handlers.render())

      fireEvent.click(
        within(fake.markers[0].element).getByRole('button', {
          name: 'Subject 1, open details'
        })
      )

      const card = screen.getByRole('group', { name: 'Selected photo' })
      expect(within(card).getByText('Subject 1')).toBeInTheDocument()
      expect(
        within(card).getByText('2 Oct 2026 · Khao Yai, Thailand')
      ).toBeInTheDocument()
      expect(onSelect).not.toHaveBeenCalled()

      fireEvent.click(within(card).getByRole('button', { name: 'Open photo' }))
      expect(onSelect).toHaveBeenCalledWith('media-1')

      fireEvent.click(
        within(card).getByRole('button', { name: 'Close selected photo' })
      )
      expect(screen.queryByRole('group', { name: 'Selected photo' })).toBeNull()
    })

    it('offers no Open photo action without onSelect', async () => {
      const fake = createFakeGl([
        { properties: { idx: 0 }, geometry: { coordinates: [101.4, 14.4] } }
      ])
      vi.mocked(loadMaplibreModule).mockResolvedValue(fake.gl as never)

      render(
        <GalleryMap points={[makePoint(0)]} mapProvider={{ type: 'osm' }} />
      )
      await screen.findByText('OpenFreeMap')
      act(() => fake.handlers.render())
      fireEvent.click(within(fake.markers[0].element).getByRole('button'))

      expect(
        screen.getByRole('group', { name: 'Selected photo' })
      ).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Open photo' })).toBeNull()
    })

    it('zooms into a cluster, and falls back to its newest photo once it cannot split and the source lists no members', async () => {
      const points = [makePoint(0), makePoint(1)]
      const fake = createFakeGl([
        {
          properties: { cluster: true, cluster_id: 3, point_count: 2, rep: 0 },
          geometry: { coordinates: [101.45, 14.45] }
        }
      ])
      vi.mocked(loadMaplibreModule).mockResolvedValue(fake.gl as never)

      render(<GalleryMap points={points} mapProvider={{ type: 'osm' }} />)
      await screen.findByText('OpenFreeMap')
      act(() => fake.handlers.render())

      const button = within(fake.markers[0].element).getByRole('button')
      fireEvent.click(button)
      expect(fake.map.easeTo).toHaveBeenCalledWith({
        center: [101.45, 14.45],
        zoom: 7
      })
      expect(screen.queryByRole('group', { name: 'Selected photo' })).toBeNull()

      fake.state.zoom = 16
      fireEvent.click(button)
      expect(
        await screen.findByRole('group', { name: 'Selected photo' })
      ).toBeInTheDocument()
    })

    it('lists the members of a cluster that cannot split, each one reachable', async () => {
      const onSelect = vi.fn()
      const points = [makePoint(0), makePoint(1), makePoint(2)]
      const fake = createFakeGl([
        {
          properties: { cluster: true, cluster_id: 3, point_count: 3, rep: 0 },
          geometry: { coordinates: [101.45, 14.45] }
        }
      ])
      fake.map.getSource.mockReturnValue({
        setData: fake.sourceData.setData,
        getClusterLeaves: vi.fn(async () =>
          [2, 0, 1].map((idx) => ({ properties: { idx } }))
        )
      } as never)
      vi.mocked(loadMaplibreModule).mockResolvedValue(fake.gl as never)

      render(
        <GalleryMap
          points={points}
          mapProvider={{ type: 'osm' }}
          onSelect={onSelect}
        />
      )
      await screen.findByText('OpenFreeMap')
      act(() => fake.handlers.render())
      fake.state.zoom = 16
      fireEvent.click(within(fake.markers[0].element).getByRole('button'))

      const list = await screen.findByRole('group', {
        name: 'Selected photos'
      })
      const rows = within(list).getAllByRole('button', { name: /Subject/ })
      expect(rows.map((row) => row.textContent)).toEqual([
        expect.stringContaining('Subject 0'),
        expect.stringContaining('Subject 1'),
        expect.stringContaining('Subject 2')
      ])

      fireEvent.click(rows[1])
      expect(onSelect).toHaveBeenCalledWith('media-1')

      fireEvent.click(
        within(list).getByRole('button', { name: 'Close selected photos' })
      )
      expect(
        screen.queryByRole('group', { name: 'Selected photos' })
      ).toBeNull()
    })

    it('replaces the source data and reframes when the points change', async () => {
      const fake = createFakeGl()
      vi.mocked(loadMaplibreModule).mockResolvedValue(fake.gl as never)
      const { rerender } = render(
        <GalleryMap
          points={[makePoint(0), makePoint(1)]}
          mapProvider={{ type: 'osm' }}
        />
      )
      await screen.findByText('OpenFreeMap')

      rerender(
        <GalleryMap points={[makePoint(2)]} mapProvider={{ type: 'osm' }} />
      )

      await waitFor(() => expect(fake.sourceData.setData).toHaveBeenCalled())
      expect(fake.sourceData.setData.mock.calls[0][0].features).toHaveLength(1)
      const moved = makePoint(2)
      expect(fake.map.fitBounds).toHaveBeenLastCalledWith(
        [
          [moved.longitude, moved.latitude],
          [moved.longitude, moved.latitude]
        ],
        expect.anything()
      )
    })

    it('tears the map down on unmount', async () => {
      const fake = createFakeGl()
      vi.mocked(loadMaplibreModule).mockResolvedValue(fake.gl as never)
      const { unmount } = render(
        <GalleryMap points={[makePoint(0)]} mapProvider={{ type: 'osm' }} />
      )
      await screen.findByText('OpenFreeMap')

      unmount()

      expect(fake.map.remove).toHaveBeenCalled()
    })

    it('says the map is unavailable but keeps the places list when the library fails', async () => {
      vi.mocked(loadMaplibreModule).mockRejectedValue(new Error('offline'))

      render(
        <GalleryMap
          points={[makePoint(0), makePoint(1)]}
          mapProvider={{ type: 'osm' }}
        />
      )

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Map unavailable'
      )
      expect(
        screen.getByRole('heading', { name: 'Places' })
      ).toBeInTheDocument()
      expect(screen.getByText('Khao Yai, Thailand')).toBeInTheDocument()
    })

    it('notes that area markers are not exact spots', async () => {
      const fake = createFakeGl()
      vi.mocked(loadMaplibreModule).mockResolvedValue(fake.gl as never)

      const { rerender } = render(
        <GalleryMap
          points={[makePoint(0, { precision: 'area' })]}
          mapProvider={{ type: 'osm' }}
        />
      )
      expect(
        screen.getByText('Markers show the area, not the exact spot')
      ).toBeInTheDocument()

      rerender(
        <GalleryMap points={[makePoint(0)]} mapProvider={{ type: 'osm' }} />
      )
      expect(
        screen.queryByText('Markers show the area, not the exact spot')
      ).toBeNull()
    })
  })

  it('lists the places with their counts under the map', () => {
    vi.mocked(loadMaplibreModule).mockReturnValue(new Promise(() => {}))
    const points = [
      makePoint(0, { placeName: 'Hakone, Japan' }),
      makePoint(1),
      makePoint(2),
      makePoint(3, { placeName: null })
    ]

    render(<GalleryMap points={points} mapProvider={{ type: 'osm' }} />)

    const items = within(
      screen.getByRole('heading', { name: 'Places' }).parentElement!
    ).getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual([
      'Khao Yai, Thailand2 subjects · last 3 Oct 20262 photos and videos',
      'Hakone, Japan1 subject · last 1 Oct 20261 photo or video',
      'Unnamed place1 subject · last 4 Oct 20261 photo or video'
    ])
  })

  it('expands a place into its photos and opens one through onSelect', () => {
    vi.mocked(loadMaplibreModule).mockReturnValue(new Promise(() => {}))
    const onSelect = vi.fn()
    render(
      <GalleryMap
        points={[makePoint(0), makePoint(1)]}
        mapProvider={{ type: 'osm' }}
        onSelect={onSelect}
      />
    )

    const place = screen.getByRole('button', { name: /Khao Yai, Thailand/ })
    expect(place).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(place)
    expect(place).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(screen.getByRole('button', { name: /Subject 1/ }))
    expect(onSelect).toHaveBeenCalledWith('media-1')
  })

  describe('with Apple Maps', () => {
    it('renders through MapKit with clustering annotations', async () => {
      const double = createMapKitTestDouble()
      vi.mocked(loadMapKitModule).mockResolvedValue(double.mapkit as never)
      const onSelect = vi.fn()
      const points = [makePoint(0), makePoint(1)]

      render(
        <GalleryMap
          points={points}
          mapProvider={{ type: 'apple' }}
          onSelect={onSelect}
        />
      )

      expect(await screen.findByText('Apple Maps')).toBeInTheDocument()
      await waitFor(() => expect(double.annotations).toHaveLength(2))
      expect(double.getMap()?.options).toMatchObject({
        mapType: 'mutedStandard',
        showsMapTypeControl: false
      })
      expect(double.annotations[0].options).toMatchObject({
        clusteringIdentifier: 'gallery-media'
      })

      fireEvent.click(
        double.annotations[1].element!.querySelector('button') as HTMLElement
      )
      const card = screen.getByRole('group', { name: 'Selected photo' })
      fireEvent.click(within(card).getByRole('button', { name: 'Open photo' }))
      expect(onSelect).toHaveBeenCalledWith('media-1')
    })

    it('falls back to the places list when MapKit fails', async () => {
      vi.mocked(loadMapKitModule).mockRejectedValue(new Error('no mapkit'))

      render(
        <GalleryMap points={[makePoint(0)]} mapProvider={{ type: 'apple' }} />
      )

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Map unavailable'
      )
      expect(
        screen.getByRole('heading', { name: 'Places' })
      ).toBeInTheDocument()
    })
  })
})
