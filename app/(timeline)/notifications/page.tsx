import { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { Pagination } from '@/lib/components/pagination/Pagination'
import { getDatabase } from '@/lib/database'
import { groupNotifications } from '@/lib/services/notifications/groupNotifications'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { NotificationsList } from './NotificationsList'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Notifications'
}

const ITEMS_PER_PAGE = 25

interface Props {
  searchParams: Promise<{ page?: string }>
}

const Page = async ({ searchParams }: Props) => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Fail to load database')
  }

  const session = await getServerSession(getAuthOptions())
  const actor = await getActorFromSession(database, session)
  if (!actor) {
    return redirect('/auth/signin')
  }

  const params = await searchParams
  const currentPage = parseInt(params.page || '1', 10)
  const offset = (currentPage - 1) * ITEMS_PER_PAGE

  const [notifications, totalCount] = await Promise.all([
    database.getNotifications({
      actorId: actor.id,
      limit: ITEMS_PER_PAGE,
      offset
    }),
    database.getNotificationsCount({ actorId: actor.id })
  ])

  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE)

  // Group notifications by groupKey
  const groupedNotifications = groupNotifications(notifications)

  // Transform to include account and status data
  const notificationsWithData = await Promise.all(
    groupedNotifications.map(async (notification) => {
      const account = await database.getMastodonActorFromId({
        id: notification.sourceActorId
      })

      let status = null
      if (notification.statusId) {
        status = await database.getStatus({
          statusId: notification.statusId,
          withReplies: false
        })
      }

      let groupedAccounts = null
      if (notification.groupedActors && notification.groupedActors.length > 1) {
        groupedAccounts = (
          await Promise.all(
            notification.groupedActors
              .slice(0, 3)
              .map((actorId) =>
                database.getMastodonActorFromId({ id: actorId })
              )
          )
        ).filter(Boolean)
      }

      return {
        ...notification,
        account,
        status,
        groupedAccounts
      }
    })
  )

  const filteredNotifications = notificationsWithData.filter((notification) => {
    if (!notification.account) return false
    if (
      ['like', 'reply', 'mention'].includes(notification.type) &&
      (!notification.status || !notification.status.actor)
    ) {
      return false
    }
    return true
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Notifications</h1>
      </div>

      {filteredNotifications.length === 0 ? (
        <div className="rounded-xl border bg-background/80 p-8 text-center text-muted-foreground">
          No notifications yet
        </div>
      ) : (
        <>
          <NotificationsList
            notifications={filteredNotifications}
            currentActorId={actor.id}
          />

          {totalPages > 1 && (
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              basePath="/notifications"
            />
          )}
        </>
      )}
    </div>
  )
}

export default Page
