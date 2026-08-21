import { FitnessRouteHeatmap } from '@/lib/types/database/fitnessRouteHeatmap'

import {
  UNRESOLVED_SHARE_METADATA,
  buildSharedHeatmapMetadata
} from './sharedHeatmapMetadata'
import {
  HEATMAP_CARD_IMAGE_HEIGHT,
  HEATMAP_CARD_IMAGE_WIDTH,
  buildSharedHeatmapView
} from './sharedHeatmapView'

const baseHeatmap: FitnessRouteHeatmap = {
  id: 'hm-1',
  actorId: 'https://llun.test/users/alice',
  activityType: undefined,
  periodType: 'all_time',
  periodKey: 'all',
  region: '',
  segments: [{ points: [{ lat: 52, lng: 5.6 }] }],
  bounds: { minLat: 52, maxLat: 52.6, minLng: 5.6, maxLng: 6.2 },
  status: 'completed',
  activityCount: 342,
  pointCount: 9001,
  totalCount: 9001,
  cursorOffset: 9001,
  isPartial: false,
  createdAt: 1000,
  updatedAt: Date.UTC(2026, 5, 24, 12)
}

const owner = { name: 'Alice Rider', username: 'alice', domain: 'llun.test' }

const buildMetadata = ({
  region = '',
  regionName,
  siteName = 'llun.social'
}: {
  region?: string
  regionName?: string
  siteName?: string
} = {}) =>
  buildSharedHeatmapMetadata({
    view: buildSharedHeatmapView({
      heatmap: { ...baseHeatmap, region },
      owner,
      regionName,
      origin: 'https://llun.test',
      token: 'tok123'
    }),
    siteName
  })

describe('buildSharedHeatmapMetadata', () => {
  it('titles the card after the shared region', () => {
    const metadata = buildMetadata({
      region: 'rect:52.00,5.00,51.00,6.00',
      regionName: 'Netherlands'
    })

    expect(metadata.title).toBe('Route heatmap — Netherlands')
    expect(metadata.openGraph?.title).toBe('Route heatmap — Netherlands')
  })

  it('describes the owner and the generated date', () => {
    const metadata = buildMetadata()

    expect(metadata.title).toBe('Route heatmap — Whole world')
    expect(metadata.description).toBe(
      'Alice Rider (@alice@llun.test) · Generated June 24, 2026'
    )
  })

  it('leaves the bounding box out of the description', () => {
    // The page shows it under the heading, where it has room to be a caption.
    // As a card subtitle "TL 52.50°N 4.80°E → BR 52.30°N 5.00°E" reads as debug
    // output, and the map locates the share better than its corners do.
    const view = buildSharedHeatmapView({
      heatmap: { ...baseHeatmap, region: 'rect:52.00,5.00,51.00,6.00' },
      owner,
      regionName: 'Netherlands',
      origin: 'https://llun.test',
      token: 'tok123'
    })
    expect(view.bboxLabel).toBeTruthy()

    const metadata = buildSharedHeatmapMetadata({
      view,
      siteName: 'llun.social'
    })

    expect(metadata.description).toBe(
      'Alice Rider (@alice@llun.test) · Generated June 24, 2026'
    )
    expect(metadata.description).not.toContain(view.bboxLabel)
  })

  it('points og:image at the raster card image with matching dimensions', () => {
    const metadata = buildMetadata()

    expect(metadata.openGraph?.images).toEqual([
      {
        url: 'https://llun.test/embed/heatmap/tok123/image?w=1200&h=600&format=png',
        width: HEATMAP_CARD_IMAGE_WIDTH,
        height: HEATMAP_CARD_IMAGE_HEIGHT,
        alt: 'Route heatmap — Whole world'
      }
    ])
    expect(metadata.openGraph).toMatchObject({
      type: 'website',
      url: 'https://llun.test/u/heatmaps/tok123',
      siteName: 'llun.social'
    })
  })

  it('requests a large twitter card carrying the same image', () => {
    const metadata = buildMetadata()

    // summary_large_image is what makes the map legible; the default `summary`
    // crops it to a small square thumbnail.
    expect(metadata.twitter).toMatchObject({
      card: 'summary_large_image',
      title: 'Route heatmap — Whole world'
    })
    expect(metadata.twitter?.images).toEqual(metadata.openGraph?.images)
  })

  it('keeps the share out of search indexes', () => {
    // The token is the secret. A card crawler reads OpenGraph without consulting
    // robots, so the card survives this; a search index would not be meant to.
    expect(buildMetadata().robots).toEqual({ index: false, follow: false })
  })

  it('drops og:site_name when the instance name is blank', () => {
    expect(
      buildMetadata({ siteName: '   ' }).openGraph?.siteName
    ).toBeUndefined()
  })
})

describe('UNRESOLVED_SHARE_METADATA', () => {
  it('publishes no card for a share that will not render', () => {
    // A revoked, re-queued or unclipped-region token 404s. Describing it would
    // hand a crawler the region name, the handle and a thumbnail for a page
    // that refuses to serve any of them.
    expect(UNRESOLVED_SHARE_METADATA.openGraph).toBeUndefined()
    expect(UNRESOLVED_SHARE_METADATA.twitter).toBeUndefined()
    expect(UNRESOLVED_SHARE_METADATA.description).toBeUndefined()
    expect(UNRESOLVED_SHARE_METADATA.title).toBe('Route heatmap')
    expect(UNRESOLVED_SHARE_METADATA.robots).toEqual({
      index: false,
      follow: false
    })
  })
})
