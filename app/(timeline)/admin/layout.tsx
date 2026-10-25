import { FC, ReactNode } from 'react'

import { SectionLayout } from '@/lib/components/section-nav'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

import { adminGroups } from './sections'

interface Props {
  children: ReactNode
}

// Grouped like Settings and Account; the index splits after Community, so
// Dashboard, Moderation and Community fill its left column.
const Layout: FC<Props> = async ({ children }) => {
  const database = getDatabase()
  const admin = database
    ? await getAdminFromSession(database, await getServerAuthSession())
    : null
  const groups =
    database && admin
      ? adminGroups(await database.countOpenReports({ limit: 100 }))
      : adminGroups()

  return (
    <SectionLayout
      label="Admin"
      title="Admin"
      description="Moderate accounts, reports, and server settings"
      indexUrl="/admin"
      groups={groups}
      splitAt={3}
    >
      {children}
    </SectionLayout>
  )
}

export default Layout
