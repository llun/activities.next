import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { NotificationSettings } from '@/lib/components/settings/NotificationSettings'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { NotificationType } from '@/lib/types/database/operations'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Notification Settings'
}

const notificationTypes: {
  key: NotificationType
  label: string
  description: string
}[] = [
  {
    key: 'follow_request',
    label: 'Follow Requests',
    description: 'Someone requests to follow you'
  },
  {
    key: 'follow',
    label: 'New Followers',
    description: 'Someone follows you'
  },
  {
    key: 'like',
    label: 'Likes',
    description: 'Someone likes your post'
  },
  {
    key: 'mention',
    label: 'Mentions',
    description: 'Someone mentions you in their post'
  },
  {
    key: 'reply',
    label: 'Replies',
    description: 'Someone replies to your post'
  },
  {
    key: 'reblog',
    label: 'Reblogs',
    description: 'Someone reblogs your post'
  },
  {
    key: 'activity_import',
    label: 'Fitness Activity Imported',
    description:
      'A Strava fitness activity has been imported and is ready to view'
  }
]

interface PageProps {
  searchParams: Promise<{ actorId?: string }>
}

const Page = async ({ searchParams }: PageProps) => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Fail to load database')
  }

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  if (!actor || !actor.account) {
    return redirect('/auth/signin')
  }

  // Get all actors for this account
  const actors = await database.getActorsForAccount({
    accountId: actor.account.id
  })

  // Determine which actor's settings to display
  const params = await searchParams
  const selectedActorId = params.actorId || actor.id
  const selectedActor = actors.find((a) => a.id === selectedActorId) || actor

  // Get current notification settings
  const settings = await database.getActorSettings({
    actorId: selectedActor.id
  })
  const emailNotifications = settings?.emailNotifications || {}
  const pushNotifications = settings?.pushNotifications || {}

  return (
    <NotificationSettings
      actorId={selectedActor.id}
      accountEmail={actor.account.email}
      actors={actors}
      emailNotifications={emailNotifications}
      pushNotifications={pushNotifications}
      notificationTypes={notificationTypes}
    />
  )
}

export default Page
