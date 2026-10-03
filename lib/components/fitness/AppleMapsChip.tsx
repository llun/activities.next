import type { FC } from 'react'

import { APPLE_MAPS_LABEL } from '@/lib/components/fitness/mapkitSurface'
import { cn } from '@/lib/utils'

/**
 * The "Apple Maps" attribution chip drawn over an Apple-rendered map surface.
 * It positions itself with whatever `absolute` offsets the caller passes, so
 * the same chip sits bottom-right on the interactive route map and bottom-left
 * (where Apple bakes its logo) over the static route image.
 */
export const AppleMapsChip: FC<{ className?: string }> = ({ className }) => (
  <div
    className={cn(
      'pointer-events-none absolute rounded bg-background/90 px-2 py-1 text-[10px] font-medium text-muted-foreground shadow-sm',
      className
    )}
  >
    {APPLE_MAPS_LABEL}
  </div>
)
