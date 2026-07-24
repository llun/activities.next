'use client'

import {
  AlertTriangle,
  BarChart,
  Filter,
  Globe,
  Hash,
  Image,
  Link as LinkIcon,
  Megaphone,
  Rss,
  Scale,
  Server,
  Settings,
  Smile,
  User
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

// One flat run, ordered as the design system's admin sub-nav: the moderation
// and content tools first, then federation, then the server-settings pages. No
// group headings or separators — every entry here is already an admin setting,
// so splitting off a "Settings" group only implied the others weren't.
//
// Design order is kept verbatim for the tabs it covers. Its Trends and Invites
// entries have no page here yet, and Hashtags/Relays/Custom emojis/System have
// no design entry — those sit next to the tab they belong with.
const tabs: SectionNavTab[] = [
  { name: 'Overview', url: '/admin', icon: BarChart },
  { name: 'Accounts', url: '/admin/accounts', icon: User },
  { name: 'Reports', url: '/admin/reports', icon: AlertTriangle },
  { name: 'Server rules', url: '/admin/rules', icon: Scale },
  { name: 'Hashtags', url: '/admin/tags', icon: Hash },
  { name: 'Announcements', url: '/admin/announcements', icon: Megaphone },
  { name: 'Filters', url: '/admin/filters', icon: Filter },
  { name: 'Custom emojis', url: '/admin/emojis', icon: Smile },
  { name: 'Federation', url: '/admin/federation', icon: Globe },
  { name: 'Relays', url: '/admin/relays', icon: Rss },
  { name: 'Posts & media', url: '/admin/posts', icon: Image },
  { name: 'Network', url: '/admin/network', icon: LinkIcon },
  { name: 'Instance', url: '/admin/instance', icon: Settings },
  { name: 'System', url: '/admin/system', icon: Server }
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
