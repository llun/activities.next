'use client'

import {
  BarChart3,
  Filter,
  Flag,
  Globe,
  Hash,
  Megaphone,
  Rss,
  Scale,
  Settings,
  Smile,
  Users
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
  { name: 'Overview', url: '/admin', icon: BarChart3 },
  { name: 'Accounts', url: '/admin/accounts', icon: Users },
  { name: 'Reports', url: '/admin/reports', icon: Flag },
  { name: 'Hashtags', url: '/admin/tags', icon: Hash },
  { name: 'Filters', url: '/admin/filters', icon: Filter },
  { name: 'Rules', url: '/admin/rules', icon: Scale },
  { name: 'Announcements', url: '/admin/announcements', icon: Megaphone },
  { name: 'Federation', url: '/admin/federation', icon: Globe },
  { name: 'Relays', url: '/admin/relays', icon: Rss },
  { name: 'Custom emojis', url: '/admin/emojis', icon: Smile },
  { name: 'System', url: '/admin/system', icon: Settings }
]

const Layout: FC<Props> = ({ children }) => {
  return (
    <>
      {/* Shared section header — sticky chrome, outside the section provider, so
          the admin section reads like Settings/Fitness and the other top-level
          routes. Per-page titles ("Overview", "Accounts", …) render below in
          section mode. */}
      <PageHeader
        title="Admin"
        description="Moderate accounts, reports, and instance settings"
      />
      <PageHeaderSectionProvider>
        <div className="w-full pt-4">
          {/* Dropdown sub-navigation on every breakpoint (desktop included) so
              the content always gets the full width — no vertical rail. */}
          <SectionNavDropdown label="Admin" tabs={tabs} />

          <div className="min-w-0">{children}</div>
        </div>
      </PageHeaderSectionProvider>
    </>
  )
}

export default Layout
