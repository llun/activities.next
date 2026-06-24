import { serializeRegion } from '@/lib/fitness/regions'
import { FitnessRouteHeatmap } from '@/lib/types/database/fitnessRouteHeatmap'

import {
  buildSharedHeatmapView,
  computeInitials,
  formatActivityLabel,
  formatGeneratedDate,
  formatPeriodLabel
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

describe('formatActivityLabel', () => {
  it.each([
    {
      description: 'undefined → All activities',
      input: undefined,
      expected: 'All activities'
    },
    {
      description: 'null → All activities',
      input: null,
      expected: 'All activities'
    },
    {
      description: 'humanises trail_run',
      input: 'trail_run',
      expected: 'Trail Run'
    }
  ])('$description', ({ input, expected }) => {
    expect(formatActivityLabel(input)).toBe(expected)
  })
})

describe('formatPeriodLabel', () => {
  it('returns All time for the all-time period', () => {
    expect(formatPeriodLabel('all_time', 'all')).toBe('All time')
  })
  it('returns the raw period key otherwise', () => {
    expect(formatPeriodLabel('yearly', '2025')).toBe('2025')
    expect(formatPeriodLabel('monthly', '2025-06')).toBe('2025-06')
  })
})

describe('computeInitials', () => {
  it.each([
    { description: 'two words', input: 'Alice Rider', expected: 'AR' },
    { description: 'single word', input: 'alice', expected: 'A' },
    { description: 'caps the first two words', input: 'a b c', expected: 'AB' },
    { description: 'blank falls back to ?', input: '   ', expected: '?' },
    {
      description: 'keeps a non-BMP leading char intact (no broken surrogate)',
      input: '𝒜lice',
      expected: '𝒜'
    }
  ])('$description', ({ input, expected }) => {
    expect(computeInitials(input)).toBe(expected)
  })
})

describe('formatGeneratedDate', () => {
  it('formats an absolute long date in UTC', () => {
    expect(formatGeneratedDate(Date.UTC(2026, 5, 24, 12))).toBe('June 24, 2026')
  })

  it('does not shift a UTC-midnight instant across the date boundary', () => {
    // Without timeZone: 'UTC' this would render Dec 31, 2025 west of UTC.
    expect(formatGeneratedDate(Date.UTC(2026, 0, 1, 0))).toBe('January 1, 2026')
  })
})

describe('buildSharedHeatmapView', () => {
  it('builds the world view with read-only stats and a zeroed map heatmap', () => {
    const view = buildSharedHeatmapView({
      heatmap: baseHeatmap,
      owner,
      origin: 'https://llun.test',
      token: 'tok123'
    })

    expect(view.title).toBe('Whole world')
    expect(view.isWorld).toBe(true)
    expect(view.bboxLabel).toBeUndefined()
    expect(view.owner).toEqual({
      name: 'Alice Rider',
      handle: '@alice@llun.test',
      initials: 'AR'
    })
    expect(view.publicUrl).toBe('https://llun.test/u/heatmaps/tok123')
    expect(view.stats).toEqual({
      routes: '342',
      activity: 'All activities',
      period: 'All time'
    })
    // Internal counters are zeroed in the map payload (no public leak), but the
    // real segments/bounds are kept so the map still renders.
    expect(view.heatmap.activityCount).toBe(0)
    expect(view.heatmap.pointCount).toBe(0)
    expect(view.heatmap.totalCount).toBe(0)
    expect(view.heatmap.segments).toEqual(baseHeatmap.segments)
    expect(view.heatmap.bounds).toEqual(baseHeatmap.bounds)
  })

  it('uses the owner-assigned region name and a bbox caption for a single rect', () => {
    const region = serializeRegion({
      type: 'rect',
      nw: { lat: 52.6, lng: 5.6 },
      se: { lat: 52, lng: 6.2 }
    })
    const view = buildSharedHeatmapView({
      heatmap: { ...baseHeatmap, region },
      owner,
      regionName: 'Veluwe',
      origin: 'https://llun.test',
      token: 'tok123'
    })

    expect(view.isWorld).toBe(false)
    expect(view.title).toBe('Veluwe')
    expect(view.bboxLabel).toBe('TL 52.60°N 5.60°E → BR 52.00°N 6.20°E')
  })

  it('falls back to Map area when a rect has no saved name', () => {
    const region = serializeRegion({
      type: 'rect',
      nw: { lat: 52.6, lng: 5.6 },
      se: { lat: 52, lng: 6.2 }
    })
    const view = buildSharedHeatmapView({
      heatmap: { ...baseHeatmap, region },
      owner,
      origin: 'https://llun.test',
      token: 'tok123'
    })
    expect(view.title).toBe('Map area')
  })

  it('humanises a filtered activity and yearly period in the stats', () => {
    const view = buildSharedHeatmapView({
      heatmap: {
        ...baseHeatmap,
        activityType: 'trail_run',
        periodType: 'yearly',
        periodKey: '2025'
      },
      owner,
      origin: 'https://llun.test',
      token: 'tok123'
    })
    expect(view.stats.activity).toBe('Trail Run')
    expect(view.stats.period).toBe('2025')
  })

  it('does not double the slash when the origin has a trailing slash', () => {
    const view = buildSharedHeatmapView({
      heatmap: baseHeatmap,
      owner,
      origin: 'https://llun.test/',
      token: 'tok123'
    })
    expect(view.publicUrl).toBe('https://llun.test/u/heatmaps/tok123')
  })

  it('derives the handle from the actor id when the owner is missing', () => {
    const view = buildSharedHeatmapView({
      heatmap: baseHeatmap,
      owner: null,
      origin: 'https://llun.test',
      token: 'tok123'
    })
    expect(view.owner.handle).toBe('@alice@llun.test')
    expect(view.owner.name).toBe('Athlete')
  })
})
