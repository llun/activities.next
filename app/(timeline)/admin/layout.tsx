'use client'

import { FC, ReactNode } from 'react'

import { ADMIN_ICONS } from '@/lib/components/admin/adminIcons'
import { SectionLayout } from '@/lib/components/section-nav'
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
  { name: 'Domains', url: '/admin/domains', icon: ADMIN_ICONS.domains },
  { name: 'Posts & media', url: '/admin/posts', icon: ADMIN_ICONS.posts },
  { name: 'Network', url: '/admin/network', icon: ADMIN_ICONS.network },
  { name: 'Instance', url: '/admin/instance', icon: ADMIN_ICONS.instance },
  { name: 'Queues', url: '/admin/queues', icon: ADMIN_ICONS.queues },
  { name: 'System', url: '/admin/system', icon: ADMIN_ICONS.system }
]

const Layout: FC<Props> = ({ children }) => {
  // Admin is a settings-style section: the navigation rail is shown from lg up
  // (flat, in today's order), and the dropdown is shown below lg until the admin
  // groups arrive in a later step. There is no indexUrl because /admin is the
  // Overview page itself, not a section index, and no footer.
  return (
    <SectionLayout
      label="Admin"
      title="Admin"
      description="Moderate accounts, reports, and instance settings"
      groups={[
        {
          items: tabs.map((tab) => ({
            name: tab.name,
            url: tab.url,
            icon: <tab.icon />
          }))
        }
      ]}
      mobileNav={<SectionNavDropdown label="Admin" tabs={tabs} />}
    >
      {children}
    </SectionLayout>
  )
}

export default Layout
