import { FC } from 'react'

import { SkeletonBar } from '@/lib/components/surface/Skeleton'
import { cn } from '@/lib/utils'

/**
 * The lightbox albums button's placeholder, the button's height (`h-9`, taller
 * on touch) and its typical width ("In 1 album" on sm and up, icon and count
 * below). It stands in while the albums load, and while the control's chunk
 * loads, so the top bar does not shift either way. The label's width varies
 * ("Add to album" is wider), so only the height is exact.
 */
export const MediaAlbumsPillSkeleton: FC<{ className?: string }> = ({
  className
}) => (
  <div className={cn('relative dark flex items-center', className)}>
    <p role="status">
      <span className="sr-only">Loading albums</span>
      <SkeletonBar className="h-9 w-12 rounded-md bg-white/10 pointer-coarse:h-10 sm:w-33" />
    </p>
  </div>
)
