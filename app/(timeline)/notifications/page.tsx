import { Bell } from 'lucide-react'
import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { PageHeader, PageSubnavProvider } from '@/lib/components/page-header'
import { Pagination } from '@/lib/components/pagination/Pagination'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { groupNotifications } from '@/lib/services/notifications/groupNotifications'
import type { NotificationType } from '@/lib/types/database/operations'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { urlToId } from '@/lib/utils/urlToId'

import { NotificationsList } from './NotificationsList'
import { MarkAllReadButton } from './components/MarkAllReadButton'
import {
  NotificationFilterTabs,
  type NotificationTab
} from './components/NotificationFilterTabs'
import { resolveFollowRequestStatus } from './followRequestStatus'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Notifications'
}

const ITEMS_PER_PAGE = 25
// Mastodon's "Mentions" tab covers both mentions and replies.
const MENTION_TYPES: NotificationType[] = ['mention', 'reply']
// Collection notifications carry the collection id in their groupKey
// (`<type>:<collectionId>`); the member-consent row needs it to act.
const COLLECTION_TYPES: NotificationType[] = [
  'added_to_collection',
  'collection_update'
]

const collectionIdFromGroupKey = (groupKey?: string): string | null => {
  if (!groupKey) return null
  const separator = groupKey.indexOf(':')
  if (separator === -1) return null
  return groupKey.slice(separator + 1) || null
}

interface Props {
  searchParams: Promise<{ page?: string; type?: string }>
}

const Page = async ({ searchParams }: Props) => {
  const { host } = getConfig()
  const database = getDatabase()
  if (!database) {
    throw new Error('Fail to load database')
  }

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  if (!actor) {
    return redirect('/auth/signin')
  }

  const params = await searchParams
  const tab: NotificationTab = params.type === 'mentions' ? 'mentions' : 'all'
  const types = tab === 'mentions' ? MENTION_TYPES : undefined
  // Guard against missing / non-numeric / out-of-range `?page=` values, which
  // would otherwise produce a NaN or negative offset.
  const parsedPage = parseInt(params.page ?? '1', 10)
  const currentPage =
    Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1
  const offset = (currentPage - 1) * ITEMS_PER_PAGE

  const [notifications, totalCount] = await Promise.all([
    database.getNotifications({
      actorId: actor.id,
      limit: ITEMS_PER_PAGE,
      offset,
      types
    }),
    database.getNotificationsCount({ actorId: actor.id, types })
  ])

  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE)

  // Group notifications by groupKey
  const groupedNotifications = groupNotifications(notifications)

  // Resolve the title of every referenced collection once (deduped). The read
  // is non-owner-scoped because the recipient is a member, not the owner; a
  // deleted collection simply resolves to no entry (its consent row is hidden).
  const referencedCollectionIds = Array.from(
    new Set(
      groupedNotifications
        .filter((notification) => COLLECTION_TYPES.includes(notification.type))
        .map((notification) => collectionIdFromGroupKey(notification.groupKey))
        .filter((id): id is string => Boolean(id))
    )
  )
  const collectionTitles = new Map<string, string>()
  await Promise.all(
    referencedCollectionIds.map(async (collectionId) => {
      const collection = await database.getCollectionById({ id: collectionId })
      if (collection) collectionTitles.set(collectionId, collection.title)
    })
  )

  // Transform to include account, status and collection data
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

      const collectionId = COLLECTION_TYPES.includes(notification.type)
        ? collectionIdFromGroupKey(notification.groupKey)
        : null
      const collection =
        collectionId && collectionTitles.has(collectionId)
          ? { id: collectionId, title: collectionTitles.get(collectionId)! }
          : null

      // For follow_request rows, resolve the live follow state so an already
      // handled request (accepted, rejected, or withdrawn) never offers stale
      // Approve / Reject actions.
      const followRequestStatus =
        notification.type === 'follow_request'
          ? await resolveFollowRequestStatus(database, notification, actor.id)
          : undefined

      return {
        ...notification,
        account,
        status,
        collection,
        followRequestStatus
      }
    })
  )

  // The unread rows in the loaded feed drive both the mark-all-read action
  // (expanded to grouped ids) and the count badge, so the label, the count, and
  // what the button clears all describe the same set. The global unread total
  // is surfaced on the sidebar bell instead.
  const unreadNotifications = notificationsWithData.filter(
    (notification) => !notification.isRead
  )
  const unreadCount = unreadNotifications.length
  const unreadIds = Array.from(
    new Set(
      unreadNotifications.flatMap((notification) =>
        notification.groupedIds && notification.groupedIds.length > 0
          ? notification.groupedIds
          : [notification.id]
      )
    )
  )

  return (
    <PageSubnavProvider subnav={<NotificationFilterTabs active={tab} />}>
      <PageHeader
        title="Notifications"
        description="Recent follows, replies, mentions and activity updates."
        actions={
          <MarkAllReadButton unreadIds={unreadIds} unreadCount={unreadCount} />
        }
      />

      <div className="space-y-4 pt-4">
        {notificationsWithData.length === 0 ? (
          <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Bell className="size-5" />
              </span>
              <p className="text-sm font-medium">You&apos;re all caught up</p>
              <p className="max-w-[28ch] text-sm text-muted-foreground">
                {tab === 'mentions'
                  ? 'No mentions or replies yet.'
                  : 'New activity will show up here.'}
              </p>
            </div>
          </div>
        ) : (
          <>
            <NotificationsList
              notifications={notificationsWithData}
              host={host}
              currentTime={Date.now()}
              currentAccountId={urlToId(actor.id)}
            />

            {totalPages > 1 && (
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                basePath="/notifications"
                query={tab === 'mentions' ? { type: 'mentions' } : undefined}
              />
            )}
          </>
        )}
      </div>
    </PageSubnavProvider>
  )
}

export default Page
