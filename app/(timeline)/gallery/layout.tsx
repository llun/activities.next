'use client'

import {
  Bird,
  Camera,
  FolderOpen,
  Images,
  ListChecks,
  Lock,
  MapPin
} from 'lucide-react'
import { usePathname } from 'next/navigation'
import { FC, ReactNode } from 'react'

import {
  PageHeader,
  PageHeaderSectionProvider
} from '@/lib/components/page-header'
import { SectionNavDropdown } from '@/lib/components/section-nav-dropdown'
import type { SectionNavGroup } from '@/lib/components/section-nav-shared'

interface Props {
  children: ReactNode
}

const groups: SectionNavGroup[] = [
  {
    items: [
      { name: 'Subjects', url: '/gallery', icon: <Bird /> },
      { name: 'All media', url: '/gallery/media', icon: <Images /> },
      { name: 'Albums', url: '/gallery/albums', icon: <FolderOpen /> },
      { name: 'Map', url: '/gallery/map', icon: <MapPin /> },
      { name: 'Life list', url: '/gallery/life-list', icon: <ListChecks /> },
      { name: 'Gear', url: '/gallery/gear', icon: <Camera /> },
      { name: 'Privacy', url: '/gallery/privacy', icon: <Lock /> }
    ]
  }
]

const Layout: FC<Props> = ({ children }) => {
  // Wide-column marker: every gallery route but Privacy renders
  // `data-gallery-wide`, which app/globals.css reads to widen the content
  // column (and with it the Gallery title band) to 1120px. `relative` makes
  // this wrapper the positioning parent for a page's own header row: All
  // media's actions sit on the dropdown's line from sm up (the trigger is
  // 40px tall, the wrapper's padding is 16px from md and 0 at sm, so the
  // page offsets itself by `sm:top-0 md:top-4`).
  const wide = !usePathname()?.startsWith('/gallery/privacy')

  return (
    <>
      {/* Shared section header, outside the section provider like Fitness, so
          the section reads like Settings and the other top-level routes.
          Per-page titles render below in section mode. */}
      <PageHeader
        title="Gallery"
        description="Your photos and videos, by subject, place and gear"
      />
      <PageHeaderSectionProvider>
        <div
          className="relative w-full pt-4 max-md:pt-0"
          data-gallery-wide={wide || undefined}
        >
          <SectionNavDropdown label="Gallery" groups={groups} />

          <div className="min-w-0">{children}</div>
        </div>
      </PageHeaderSectionProvider>
    </>
  )
}

export default Layout
