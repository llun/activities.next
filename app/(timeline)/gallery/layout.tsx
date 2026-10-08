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
import { FC, ReactNode } from 'react'

import {
  PageHeader,
  PageHeaderSectionProvider
} from '@/lib/components/page-header'
import {
  SectionNavDropdown,
  type SectionNavTab
} from '@/lib/components/section-nav-dropdown'

interface Props {
  children: ReactNode
}

const tabs: SectionNavTab[] = [
  { name: 'Subjects', url: '/gallery', icon: Bird },
  { name: 'Recent', url: '/gallery/recent', icon: Images },
  { name: 'Albums', url: '/gallery/albums', icon: FolderOpen },
  { name: 'Map', url: '/gallery/map', icon: MapPin },
  { name: 'Life list', url: '/gallery/life-list', icon: ListChecks },
  { name: 'Gear', url: '/gallery/gear', icon: Camera },
  { name: 'Privacy', url: '/gallery/privacy', icon: Lock }
]

const Layout: FC<Props> = ({ children }) => {
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
        <div className="w-full pt-4 max-md:pt-0">
          <SectionNavDropdown label="Gallery" tabs={tabs} />

          <div className="min-w-0">{children}</div>
        </div>
      </PageHeaderSectionProvider>
    </>
  )
}

export default Layout
