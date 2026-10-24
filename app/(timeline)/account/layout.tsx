import { FC, ReactNode } from 'react'

import { SectionLayout } from '@/lib/components/section-nav'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { getAccountFooter, getAccountGroups } from './sections'

interface Props {
  children: ReactNode
}

const Layout: FC<Props> = async ({ children }) => {
  const database = getDatabase()
  const actor = database
    ? await getActorFromSession(database, await getServerAuthSession())
    : null
  const account = actor?.account
  const actors =
    database && account
      ? await database.getActorsForAccount({ accountId: account.id })
      : []
  const handle = actor ? `@${actor.username}@${actor.domain}` : undefined

  return (
    <SectionLayout
      label="Account & security"
      title="Account & security"
      description={
        account
          ? `Shared across your profiles · ${account.email}`
          : 'Shared across your profiles'
      }
      indexUrl="/account"
      groups={getAccountGroups(
        handle ? { handle, profileCount: actors.length } : null
      )}
      footer={getAccountFooter(handle)}
    >
      {children}
    </SectionLayout>
  )
}

export default Layout
