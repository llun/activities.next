'use client'

import {
  Ban,
  Bell,
  Image as ImageIcon,
  Monitor,
  Settings as SettingsIcon,
  User,
  VolumeX
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
  { name: 'General', url: '/settings', icon: SettingsIcon },
  { name: 'Account', url: '/settings/account', icon: User },
  { name: 'Media', url: '/settings/media', icon: ImageIcon },
  { name: 'Notifications', url: '/settings/notifications', icon: Bell },
  { name: 'Blocked accounts', url: '/settings/blocks', icon: Ban },
  { name: 'Muted accounts', url: '/settings/mutes', icon: VolumeX },
  { name: 'Sessions', url: '/settings/sessions', icon: Monitor }
]

const Layout: FC<Props> = ({ children }) => {
  return (
    <>
      {/* Section-level sticky header shared by every settings page, matching the
          full-width chrome the other top-level routes use. Rendered outside the
          section provider so it keeps the sticky chrome; per-page titles
          ("General", "Account Settings", …) render below in section mode. */}
      <PageHeader
        title="Settings"
        description="Manage your account and preferences"
        contentWidth="wide"
      />
      <PageHeaderSectionProvider>
        <div data-layout-width="wide" className="mx-auto w-full max-w-4xl pt-4">
          {/* Dropdown sub-navigation on every breakpoint (desktop included) so
              the content always gets the full width — no vertical rail. */}
          <SectionNavDropdown label="Settings" tabs={tabs} />

          <div className="min-w-0">{children}</div>
        </div>
      </PageHeaderSectionProvider>
    </>
  )
}

export default Layout
