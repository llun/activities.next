import { FC } from 'react'

import { SkeletonBar } from '@/lib/components/surface/Skeleton'

/**
 * What a map container shows until its tiles and style are ready: the shimmer
 * block over the whole map area, with one polite "Loading map" for assistive
 * tech instead of a spinner and text drawn over the map. The parent must be
 * `relative`.
 */
export const MapLoadingOverlay: FC = () => (
  <div role="status" className="absolute inset-0">
    <span className="sr-only">Loading map</span>
    <SkeletonBar className="h-full rounded-none" />
  </div>
)
