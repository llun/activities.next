import { FC, ReactNode } from 'react'

import { SectionLayout } from '@/lib/components/section-nav'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { isRealAvatar } from '@/lib/utils/isRealAvatar'

import { getSettingsGroups, settingsFooter } from './sections'

interface Props {
  children: ReactNode
}

const Layout: FC<Props> = async ({ children }) => {
  const database = getDatabase()
  const actor = database
    ? await getActorFromSession(database, await getServerAuthSession())
    : null
  const profile = actor
    ? {
        handle: `@${actor.username}@${actor.domain}`,
        username: actor.username,
        iconUrl: isRealAvatar(actor.iconUrl) ? (actor.iconUrl ?? null) : null
      }
    : null

  return (
    <SectionLayout
      label="Settings"
      title="Settings"
      description={profile ? `For ${profile.handle}` : undefined}
      indexUrl="/settings"
      groups={getSettingsGroups(profile)}
      footer={settingsFooter}
    >
      {children}
    </SectionLayout>
  )
}

export default Layout
