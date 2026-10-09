import { Clock, Images, Sparkles } from 'lucide-react'
import { FC } from 'react'

import { BackLink } from '@/lib/components/back-link'
import { GalleryGridSkeleton } from '@/lib/components/gallery/GalleryGridSkeleton'
import { StatStripSkeleton } from '@/lib/components/surface/ScreenSkeleton'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'

// A subject's page: the Back link, its name and scientific name, the First
// seen, Last seen and Photos strip, and the first photos.
const Loading: FC = () => (
  <div aria-busy="true" className="space-y-6">
    <BackLink href="/gallery" accessibleName="Back to subjects" />
    <div aria-hidden="true" className="space-y-6">
      <div className="space-y-2">
        <SkeletonBar className="h-7 w-48" />
        <SkeletonBar className="h-4 w-36" />
      </div>
      <StatStripSkeleton
        cells={[
          { label: 'First seen', icon: Sparkles },
          { label: 'Last seen', icon: Clock },
          { label: 'Photos', icon: Images }
        ]}
      />
    </div>
    <GalleryGridSkeleton label="Loading subject" />
  </div>
)

export default Loading
