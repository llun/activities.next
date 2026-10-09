import { Clapperboard, Images, MapPin } from 'lucide-react'
import { FC } from 'react'

import { BackLink } from '@/lib/components/back-link'
import { GalleryGridSkeleton } from '@/lib/components/gallery/GalleryGridSkeleton'
import { StatStripSkeleton } from '@/lib/components/surface/ScreenSkeleton'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'

// A piece of gallery gear: the Back link, its name and meta line, the usage
// strip, the action row and the first photos taken with it.
const Loading: FC = () => (
  <div aria-busy="true" className="space-y-6">
    <BackLink href="/gallery/gear" accessibleName="Back to gear" />
    <div aria-hidden="true" className="space-y-6">
      <div className="space-y-2">
        <SkeletonBar className="h-7 w-48" />
        <SkeletonBar className="h-4 w-72 max-w-full" />
      </div>
      <StatStripSkeleton
        cells={[
          { label: 'Photos', icon: Images },
          { label: 'Videos', icon: Clapperboard },
          { label: 'Places', icon: MapPin }
        ]}
      />
      <div className="flex gap-2">
        <SkeletonBar className="h-8 w-16" />
        <SkeletonBar className="h-8 w-20" />
        <SkeletonBar className="h-8 w-20" />
      </div>
    </div>
    <GalleryGridSkeleton label="Loading gear" />
  </div>
)

export default Loading
