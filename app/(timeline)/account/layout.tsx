'use client'

import { Lock, Monitor, User } from 'lucide-react'
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

// Account is the umbrella over an account's actors: the identity, security, and
// sessions every actor shares. It mirrors the Settings chrome — a shared
// section header plus a dropdown sub-nav on every breakpoint — with three
// sections. Per-actor settings stay in Settings.
const tabs: SectionNavTab[] = [
  { name: 'General', url: '/account', icon: User },
  { name: 'Security', url: '/account/security', icon: Lock },
  { name: 'Sessions', url: '/account/sessions', icon: Monitor }
]

const Layout: FC<Props> = ({ children }) => {
  return (
    <>
      {/* Section-level sticky header shared by every account page, matching the
          full-width chrome the other top-level routes use. Rendered outside the
          section provider so it keeps the sticky chrome; per-page titles
          ("General", "Security", "Sessions") render below in section mode. */}
      <PageHeader
        title="Account"
        description="Identity, security, and sessions shared across your actors"
      />
      <PageHeaderSectionProvider>
        <div className="w-full pt-4">
          {/* Dropdown sub-navigation on every breakpoint (desktop included) so
              the content always gets the full width — no vertical rail. */}
          <SectionNavDropdown label="Account" tabs={tabs} />

          <div className="min-w-0">{children}</div>
        </div>
      </PageHeaderSectionProvider>
    </>
  )
}

export default Layout
