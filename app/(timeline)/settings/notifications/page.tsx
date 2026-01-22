import { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { ActorSelector } from '@/lib/components/settings/ActorSelector'
import { Button } from '@/lib/components/ui/button'
import { Label } from '@/lib/components/ui/label'
import { getDatabase } from '@/lib/database'
import { NotificationType } from '@/lib/database/types/notification'
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

  const session = await getServerSession(getAuthOptions())
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

  // Get current email notification settings
  const settings = await database.getActorSettings({
    actorId: selectedActor.id
  })
  const emailNotifications = settings?.emailNotifications || {}

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Notification Settings</h1>
        <p className="text-sm text-muted-foreground">
          Control which notifications send emails to{' '}
          <span className="font-medium">{actor.account.email}</span>.{' '}
          <Link
            href="/settings"
            className="text-blue-600 hover:text-blue-800 underline"
          >
            Change email address
          </Link>
        </p>
      </div>

      <form action="/api/v1/accounts/email-notifications" method="post">
        <section className="space-y-4 rounded-2xl border bg-background/80 p-6 shadow-sm">
          <div>
            <h2 className="text-lg font-semibold">Email Notifications</h2>
            <p className="text-sm text-muted-foreground">
              Choose which types of notifications send you an email. You'll
              still see all notifications in your notifications tab.
            </p>
          </div>

          <ActorSelector actors={actors} selectedActorId={selectedActor.id} />

          <div className="space-y-4">
            {notificationTypes.map((notificationType) => (
              <div
                key={notificationType.key}
                className="flex items-center justify-between gap-4"
              >
                <div className="space-y-0.5">
                  <Label
                    htmlFor={`${notificationType.key}Input`}
                    className="cursor-pointer"
                  >
                    {notificationType.label}
                  </Label>
                  <p className="text-[0.8rem] text-muted-foreground">
                    {notificationType.description}
                  </p>
                </div>
                <input
                  type="hidden"
                  name={`${notificationType.key}_marker`}
                  value="true"
                />
                <input
                  type="checkbox"
                  id={`${notificationType.key}Input`}
                  name={notificationType.key}
                  defaultChecked={
                    emailNotifications[notificationType.key] !== false
                  }
                  className="h-4 w-4 rounded border-gray-300"
                />
              </div>
            ))}
          </div>
        </section>

        <div className="flex justify-end mt-6">
          <Button type="submit">Save Settings</Button>
        </div>
      </form>
    </div>
  )
}

export default Page
