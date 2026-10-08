/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { createMapKitTestDouble } from '@/lib/components/fitness/mapkitTestDouble'
import type { GalleryMapPoint } from '@/lib/services/gallery/galleryEntities'
import { loadMapKitModule } from '@/lib/utils/mapkit'

import { GalleryMapKit } from './GalleryMapKit'

vi.mock('@/lib/utils/mapkit', () => ({ loadMapKitModule: vi.fn() }))

const mockLoadMapKitModule = vi.mocked(loadMapKitModule)

const makePoint = (
  index: number,
  overrides: Partial<GalleryMapPoint> = {}
): GalleryMapPoint => ({
  mediaId: `media-${index}`,
  statusId: `status-${index}`,
  latitude: 10 + index,
  longitude: 20 + index,
  precision: 'exact',
  subjectName: `Subject ${index}`,
  placeName: null,
  thumbnailUrl: `https://cdn.example/thumb-${index}.jpg`,
  takenAt: null,
  ...overrides
})

type ClusterHook = (cluster: {
  coordinate: { latitude: number; longitude: number }
  memberAnnotations: Array<{ data?: unknown }>
}) => { element: HTMLElement }

describe('GalleryMapKit', () => {
  beforeEach(() => {
    mockLoadMapKitModule.mockReset()
  })

  it('shows the loading overlay while MapKit loads', () => {
    mockLoadMapKitModule.mockReturnValue(new Promise(() => {}))

    render(
      <GalleryMapKit
        points={[makePoint(0)]}
        onPick={vi.fn()}
        onUnavailable={vi.fn()}
      />
    )

    expect(screen.getByText(/Loading map/)).toBeInTheDocument()
    expect(screen.queryByText('Apple Maps')).toBeNull()
  })

  it('draws one clustering thumbnail annotation per point and frames them', async () => {
    const double = createMapKitTestDouble()
    mockLoadMapKitModule.mockResolvedValue(double.mapkit as never)

    render(
      <GalleryMapKit
        points={[makePoint(0), makePoint(1), makePoint(3)]}
        onPick={vi.fn()}
        onUnavailable={vi.fn()}
      />
    )

    expect(await screen.findByText('Apple Maps')).toBeInTheDocument()
    await waitFor(() => expect(double.annotations).toHaveLength(3))
    const map = double.getMap()!
    expect(map.currentAnnotations).toHaveLength(3)
    expect(double.annotations[0].coordinate).toEqual({
      latitude: 10,
      longitude: 20
    })
    expect(double.annotations[0].options).toMatchObject({
      clusteringIdentifier: 'gallery-media',
      data: { mediaId: 'media-0' }
    })
    expect(double.annotations[0].element?.querySelector('img')).toHaveAttribute(
      'src',
      'https://cdn.example/thumb-0.jpg'
    )
    // Framed on the points with the 20% headroom boundsToRegion adds.
    expect(map.region.center).toEqual({ latitude: 11.5, longitude: 21.5 })
    expect(map.region.span.latitudeDelta).toBeCloseTo(3.6)
  })

  it('keeps a lone point framed with some context around it', async () => {
    const double = createMapKitTestDouble()
    mockLoadMapKitModule.mockResolvedValue(double.mapkit as never)

    render(
      <GalleryMapKit
        points={[makePoint(0)]}
        onPick={vi.fn()}
        onUnavailable={vi.fn()}
      />
    )

    await waitFor(() => expect(double.annotations).toHaveLength(1))
    expect(double.getMap()!.region.span).toEqual({
      latitudeDelta: 0.05,
      longitudeDelta: 0.05
    })
  })

  it('reports a tapped marker through onPick', async () => {
    const double = createMapKitTestDouble()
    mockLoadMapKitModule.mockResolvedValue(double.mapkit as never)
    const onPick = vi.fn()

    render(
      <GalleryMapKit
        points={[makePoint(0), makePoint(1)]}
        onPick={onPick}
        onUnavailable={vi.fn()}
      />
    )
    await waitFor(() => expect(double.annotations).toHaveLength(2))

    fireEvent.click(
      double.annotations[1].element!.querySelector('button') as HTMLElement
    )

    expect(onPick).toHaveBeenCalledWith('media-1')
  })

  it('draws a cluster as its first thumbnail with a count and zooms in on tap', async () => {
    const double = createMapKitTestDouble()
    mockLoadMapKitModule.mockResolvedValue(double.mapkit as never)
    render(
      <GalleryMapKit
        points={[makePoint(0)]}
        onPick={vi.fn()}
        onUnavailable={vi.fn()}
      />
    )
    await waitFor(() => expect(double.annotations).toHaveLength(1))
    const map = double.getMap()!
    const hook = (map as unknown as { annotationForCluster: ClusterHook })
      .annotationForCluster

    const annotation = hook({
      coordinate: { latitude: 12, longitude: 22 },
      memberAnnotations: [
        { data: { mediaId: 'a', thumbnailUrl: null } },
        { data: { mediaId: 'b', thumbnailUrl: 'https://cdn.example/b.jpg' } },
        { data: { mediaId: 'c', thumbnailUrl: 'https://cdn.example/c.jpg' } }
      ]
    })

    const element = (annotation as unknown as { element: HTMLElement }).element
    expect(
      element.querySelector('[data-gallery-marker-count]')
    ).toHaveTextContent('3')
    expect(element.querySelector('img')).toHaveAttribute(
      'src',
      'https://cdn.example/b.jpg'
    )

    const before = map.region.span.latitudeDelta
    fireEvent.click(element.querySelector('button') as HTMLElement)
    expect(map.animatedRegions).toHaveLength(1)
    expect(map.animatedRegions[0].center).toEqual({
      latitude: 12,
      longitude: 22
    })
    expect(map.animatedRegions[0].span.latitudeDelta).toBeCloseTo(before / 3)
  })

  it('hands a cluster that cannot split to onPickGroup with every member, newest first', async () => {
    const double = createMapKitTestDouble()
    mockLoadMapKitModule.mockResolvedValue(double.mapkit as never)
    const onPick = vi.fn()
    const onPickGroup = vi.fn()
    render(
      <GalleryMapKit
        points={[makePoint(0)]}
        onPick={onPick}
        onPickGroup={onPickGroup}
        onUnavailable={vi.fn()}
      />
    )
    await waitFor(() => expect(double.annotations).toHaveLength(1))
    const map = double.getMap()!
    const hook = (map as unknown as { annotationForCluster: ClusterHook })
      .annotationForCluster
    map.region.span.latitudeDelta = 0.001

    const annotation = hook({
      coordinate: { latitude: 12, longitude: 22 },
      memberAnnotations: [
        { data: { mediaId: 'c', thumbnailUrl: null, order: 2 } },
        { data: { mediaId: 'a', thumbnailUrl: null, order: 0 } },
        { data: { mediaId: 'b', thumbnailUrl: null, order: 1 } }
      ]
    })
    fireEvent.click(
      (annotation as unknown as { element: HTMLElement }).element.querySelector(
        'button'
      ) as HTMLElement
    )

    expect(onPickGroup).toHaveBeenCalledWith(['a', 'b', 'c'])
    expect(onPick).not.toHaveBeenCalled()
  })

  it('swaps the annotations when the points change', async () => {
    const double = createMapKitTestDouble()
    mockLoadMapKitModule.mockResolvedValue(double.mapkit as never)
    const props = { onPick: vi.fn(), onUnavailable: vi.fn() }
    const { rerender } = render(
      <GalleryMapKit points={[makePoint(0), makePoint(1)]} {...props} />
    )
    await waitFor(() => expect(double.annotations).toHaveLength(2))

    rerender(<GalleryMapKit points={[makePoint(2)]} {...props} />)

    await waitFor(() => expect(double.annotations).toHaveLength(3))
    expect(double.getMap()!.currentAnnotations).toHaveLength(1)
    expect(double.getMap()!.removedAnnotations).toHaveLength(2)
  })

  it('destroys the map on unmount', async () => {
    const double = createMapKitTestDouble()
    mockLoadMapKitModule.mockResolvedValue(double.mapkit as never)
    const { unmount } = render(
      <GalleryMapKit
        points={[makePoint(0)]}
        onPick={vi.fn()}
        onUnavailable={vi.fn()}
      />
    )
    await screen.findByText('Apple Maps')

    unmount()

    expect(double.getMap()!.destroyCount).toBe(1)
  })

  it('reports unavailable when MapKit fails to load', async () => {
    mockLoadMapKitModule.mockRejectedValue(new Error('blocked'))
    const onUnavailable = vi.fn()

    render(
      <GalleryMapKit
        points={[makePoint(0)]}
        onPick={vi.fn()}
        onUnavailable={onUnavailable}
      />
    )

    await waitFor(() => expect(onUnavailable).toHaveBeenCalledTimes(1))
  })
})
