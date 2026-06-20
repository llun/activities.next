'use client'

import { Activity, Files, Flame, Globe, Lock } from 'lucide-react'
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
  { name: 'Overview', url: '/fitness', icon: Activity },
  { name: 'Heatmaps', url: '/fitness/heatmap', icon: Flame },
  { name: 'Files', url: '/fitness/files', icon: Files },
  { name: 'Privacy', url: '/fitness/privacy', icon: Lock },
  { name: 'Strava', url: '/fitness/strava', icon: Globe }
]

const Layout: FC<Props> = ({ children }) => {
  return (
    <>
      {/* Shared section header — sticky chrome, outside the section provider, so
          the fitness section reads like Settings and the other top-level routes.
          Per-page titles ("Overview", "Files", …) render below in section mode. */}
      <PageHeader
        title="Fitness"
        description="Your training activity and settings"
      />
      <PageHeaderSectionProvider>
        <div className="w-full pt-4">
          {/* Dropdown sub-navigation on every breakpoint (desktop included) so
              the content always gets the full width — no vertical rail. */}
          <SectionNavDropdown label="Fitness" tabs={tabs} />

          <div className="min-w-0">{children}</div>
        </div>
      </PageHeaderSectionProvider>
    </>
  )
}

export default Layout
