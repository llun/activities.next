'use client'

import { FC, ReactNode } from 'react'

import { ADMIN_ICONS } from '@/lib/components/admin/adminIcons'
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
  { name: 'Overview', url: '/admin', icon: ADMIN_ICONS.overview },
  { name: 'Accounts', url: '/admin/accounts', icon: ADMIN_ICONS.accounts },
  { name: 'Reports', url: '/admin/reports', icon: ADMIN_ICONS.reports },
  { name: 'Server rules', url: '/admin/rules', icon: ADMIN_ICONS.rules },
  { name: 'Hashtags', url: '/admin/tags', icon: ADMIN_ICONS.tags },
  {
    name: 'Announcements',
    url: '/admin/announcements',
    icon: ADMIN_ICONS.announcements
  },
  { name: 'Filters', url: '/admin/filters', icon: ADMIN_ICONS.filters },
  { name: 'Custom emojis', url: '/admin/emojis', icon: ADMIN_ICONS.emojis },
  {
    name: 'Federation',
    url: '/admin/federation',
    icon: ADMIN_ICONS.federation
  },
  { name: 'Relays', url: '/admin/relays', icon: ADMIN_ICONS.relays },
  { name: 'Posts & media', url: '/admin/posts', icon: ADMIN_ICONS.posts },
  { name: 'Network', url: '/admin/network', icon: ADMIN_ICONS.network },
  { name: 'Instance', url: '/admin/instance', icon: ADMIN_ICONS.instance },
  { name: 'Queues', url: '/admin/queues', icon: ADMIN_ICONS.queues },
  { name: 'System', url: '/admin/system', icon: ADMIN_ICONS.system }
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
        <div className="w-full pt-4 max-md:pt-0">
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
