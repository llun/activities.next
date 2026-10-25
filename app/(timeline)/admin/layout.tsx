import { FC, ReactNode } from 'react'

import { SectionLayout } from '@/lib/components/section-nav'

import { adminGroups } from './sections'

interface Props {
  children: ReactNode
}

// Grouped like Settings and Account; the index splits after Community, so
// Dashboard, Moderation and Community fill its left column.
const Layout: FC<Props> = ({ children }) => {
  return (
    <SectionLayout
      label="Admin"
      title="Admin"
      description="Moderate accounts, reports, and server settings"
      indexUrl="/admin"
      groups={adminGroups}
      splitAt={3}
    >
      {children}
    </SectionLayout>
  )
}

export default Layout
