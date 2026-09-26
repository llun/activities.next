'use client'

import { Globe } from 'lucide-react'
import { FC, ReactNode } from 'react'

import { PageHeader } from '@/lib/components/page-header'
import {
  SectionNavDropdown,
  type SectionNavTab
} from '@/lib/components/section-nav-dropdown'

interface Props {
  children: ReactNode
}

const tabs: SectionNavTab[] = [
  { name: 'Strava', url: '/fitness/connections/strava', icon: Globe },
  { name: 'Wahoo', url: '/fitness/connections/wahoo', icon: Globe }
]

const ConnectionsLayout: FC<Props> = ({ children }) => {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Connections"
        description="Connect third-party fitness platforms to sync activities"
      />
      <SectionNavDropdown label="Connections" tabs={tabs} />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export default ConnectionsLayout
