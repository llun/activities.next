import type { CoordinateBounds } from './mapUtils'

export interface HeatmapRegion {
  id: string
  label: string
  bounds: CoordinateBounds
}

export const HEATMAP_REGIONS: HeatmapRegion[] = [
  {
    id: 'europe',
    label: 'Europe',
    bounds: { minLat: 34.0, maxLat: 72.0, minLng: -25.0, maxLng: 45.0 }
  },
  {
    id: 'southeast_asia',
    label: 'Southeast Asia',
    bounds: { minLat: -11.0, maxLat: 28.0, minLng: 92.0, maxLng: 141.0 }
  },
  {
    id: 'east_asia',
    label: 'East Asia',
    bounds: { minLat: 18.0, maxLat: 53.0, minLng: 100.0, maxLng: 146.0 }
  },
  {
    id: 'south_asia',
    label: 'South Asia',
    bounds: { minLat: 5.0, maxLat: 37.0, minLng: 60.0, maxLng: 97.0 }
  },
  {
    id: 'north_america',
    label: 'North America',
    bounds: { minLat: 15.0, maxLat: 83.0, minLng: -168.0, maxLng: -52.0 }
  },
  {
    id: 'south_america',
    label: 'South America',
    bounds: { minLat: -56.0, maxLat: 13.0, minLng: -82.0, maxLng: -34.0 }
  },
  {
    id: 'africa',
    label: 'Africa',
    bounds: { minLat: -35.0, maxLat: 38.0, minLng: -18.0, maxLng: 52.0 }
  },
  {
    id: 'oceania',
    label: 'Australia / Oceania',
    bounds: { minLat: -47.0, maxLat: -10.0, minLng: 112.0, maxLng: 180.0 }
  },
  {
    id: 'singapore',
    label: 'Singapore',
    bounds: { minLat: 1.15, maxLat: 1.48, minLng: 103.59, maxLng: 104.09 }
  },
  {
    id: 'indonesia',
    label: 'Indonesia',
    bounds: { minLat: -11.0, maxLat: 6.0, minLng: 95.0, maxLng: 141.0 }
  },
  {
    id: 'malaysia',
    label: 'Malaysia',
    bounds: { minLat: 0.85, maxLat: 7.4, minLng: 99.6, maxLng: 119.3 }
  },
  {
    id: 'thailand',
    label: 'Thailand',
    bounds: { minLat: 5.5, maxLat: 20.5, minLng: 97.3, maxLng: 105.7 }
  },
  {
    id: 'vietnam',
    label: 'Vietnam',
    bounds: { minLat: 8.3, maxLat: 23.4, minLng: 102.1, maxLng: 109.5 }
  },
  {
    id: 'philippines',
    label: 'Philippines',
    bounds: { minLat: 4.5, maxLat: 21.1, minLng: 116.9, maxLng: 126.6 }
  },
  {
    id: 'japan',
    label: 'Japan',
    bounds: { minLat: 30.0, maxLat: 46.0, minLng: 129.0, maxLng: 146.0 }
  },
  {
    id: 'south_korea',
    label: 'South Korea',
    bounds: { minLat: 33.1, maxLat: 38.7, minLng: 125.9, maxLng: 129.6 }
  },
  {
    id: 'china',
    label: 'China',
    bounds: { minLat: 18.0, maxLat: 53.5, minLng: 73.5, maxLng: 135.1 }
  },
  {
    id: 'netherlands',
    label: 'Netherlands',
    bounds: { minLat: 50.75, maxLat: 53.57, minLng: 3.35, maxLng: 7.23 }
  },
  {
    id: 'germany',
    label: 'Germany',
    bounds: { minLat: 47.2, maxLat: 55.1, minLng: 5.9, maxLng: 15.1 }
  },
  {
    id: 'france',
    label: 'France',
    bounds: { minLat: 41.3, maxLat: 51.1, minLng: -5.2, maxLng: 9.6 }
  },
  {
    id: 'uk',
    label: 'United Kingdom',
    bounds: { minLat: 49.8, maxLat: 60.9, minLng: -8.2, maxLng: 2.0 }
  },
  {
    id: 'spain',
    label: 'Spain',
    bounds: { minLat: 35.9, maxLat: 43.8, minLng: -9.3, maxLng: 4.4 }
  },
  {
    id: 'italy',
    label: 'Italy',
    bounds: { minLat: 36.6, maxLat: 47.1, minLng: 6.6, maxLng: 18.5 }
  },
  {
    id: 'switzerland',
    label: 'Switzerland',
    bounds: { minLat: 45.8, maxLat: 47.8, minLng: 5.9, maxLng: 10.5 }
  },
  {
    id: 'usa',
    label: 'United States',
    bounds: { minLat: 24.4, maxLat: 49.4, minLng: -125.0, maxLng: -66.9 }
  },
  {
    id: 'canada',
    label: 'Canada',
    bounds: { minLat: 41.7, maxLat: 83.1, minLng: -141.0, maxLng: -52.6 }
  },
  {
    id: 'australia',
    label: 'Australia',
    bounds: { minLat: -43.7, maxLat: -10.7, minLng: 113.3, maxLng: 153.6 }
  },
  {
    id: 'new_zealand',
    label: 'New Zealand',
    bounds: { minLat: -47.3, maxLat: -34.4, minLng: 166.4, maxLng: 178.6 }
  }
]

export const HEATMAP_REGION_MAP = new Map<string, HeatmapRegion>(
  HEATMAP_REGIONS.map((r) => [r.id, r])
)

/**
 * Convert a sorted, comma-separated regions string to an array of region IDs.
 * Empty string means no region filter (worldwide).
 */
export const parseRegionsString = (regions: string): string[] => {
  if (!regions) return []
  return regions.split(',').filter(Boolean)
}

/**
 * Convert an array of region IDs to a normalized, sorted comma-separated string
 * for storage in the database.
 */
export const serializeRegions = (regionIds: string[]): string =>
  [...regionIds].sort().join(',')

/**
 * Compute the union bounding box for a list of region IDs.
 * Returns null if no valid regions are found (meaning no filter / worldwide).
 */
export const getRegionBounds = (
  regionIds: string[]
): CoordinateBounds | null => {
  if (regionIds.length === 0) return null

  const validRegions = regionIds
    .map((id) => HEATMAP_REGION_MAP.get(id))
    .filter((r): r is HeatmapRegion => r !== undefined)

  if (validRegions.length === 0) return null

  const bounds: CoordinateBounds = {
    minLat: Number.POSITIVE_INFINITY,
    maxLat: Number.NEGATIVE_INFINITY,
    minLng: Number.POSITIVE_INFINITY,
    maxLng: Number.NEGATIVE_INFINITY
  }

  for (const region of validRegions) {
    bounds.minLat = Math.min(bounds.minLat, region.bounds.minLat)
    bounds.maxLat = Math.max(bounds.maxLat, region.bounds.maxLat)
    bounds.minLng = Math.min(bounds.minLng, region.bounds.minLng)
    bounds.maxLng = Math.max(bounds.maxLng, region.bounds.maxLng)
  }

  return bounds
}

/**
 * Filter route segments to only keep coordinates within the given bounds,
 * splitting on gaps where points leave the region.
 */
export const filterCoordinatesToBounds = <
  T extends { lat: number; lng: number }
>(
  segments: T[][],
  bounds: CoordinateBounds
): T[][] => {
  const result: T[][] = []

  for (const segment of segments) {
    const filtered = segment.filter(
      (p) =>
        p.lat >= bounds.minLat &&
        p.lat <= bounds.maxLat &&
        p.lng >= bounds.minLng &&
        p.lng <= bounds.maxLng
    )
    if (filtered.length >= 2) {
      result.push(filtered)
    }
  }

  return result
}
