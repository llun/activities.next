'use client'

import { formatDistance } from 'date-fns'
import Link from 'next/link'
import { ReactNode, useEffect, useRef } from 'react'

import { getNotificationStatusPath } from '@/app/(timeline)/notifications/getNotificationStatusPath'
import {
  type FollowRequestInitialStatus,
  type NotificationWithAccount,
  hasStatusActor
} from '@/app/(timeline)/notifications/types'
import { ActorDisplayName } from '@/lib/components/actors/ActorDisplayName'
import type { GroupedNotification } from '@/lib/services/notifications/groupNotifications'
import type { Mastodon } from '@/lib/types/activitypub'
import type { Status } from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'

import { ActivityImportNotification } from './components/ActivityImportNotification'
import { CollectionConsentNotification } from './components/CollectionConsentNotification'
import { FollowNotification } from './components/FollowNotification'
import { FollowRequestNotification } from './components/FollowRequestNotification'
import { NotificationTypeBadge } from './components/NotificationTypeBadge'
import { StatusNotification } from './components/StatusNotification'
import {
  NOTIFICATION_TYPE_CONFIG,
  type NotificationTypeConfig,
  getGroupedName
} from './notificationConfig'

interface Props {
  notification: GroupedNotification & {
    account: Mastodon.Account | null
    status?: Status | null
    // The collection a collection-typed notification refers to (resolved from
    // its groupKey), or null when it has been deleted.
    collection?: { id: string; title: string } | null
    // For follow_request rows: the server-resolved state of the request, so an
    // already-handled request never renders stale Approve / Reject actions.
    followRequestStatus?: FollowRequestInitialStatus
  }
  host: string
  isRead: boolean
  currentTime: number
  // The viewer's own Mastodon Account id, needed to act on their own collection
  // membership (consent). Absent for surfaces without a signed-in viewer.
  currentAccountId?: string
  observeElement: (element: HTMLElement | null) => void
}

export const NotificationItem = ({
  notification,
  host,
  isRead,
  currentTime,
  currentAccountId,
  observeElement
}: Props) => {
  const elementRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (elementRef.current && !isRead) {
      observeElement(elementRef.current)
    }
  }, [observeElement, isRead])

  const cfg: NotificationTypeConfig | undefined =
    NOTIFICATION_TYPE_CONFIG[notification.type]
  const account = notification.account
  const withAccount: NotificationWithAccount | null = account
    ? { ...notification, account, status: notification.status ?? null }
    : null

  const relativeCreatedAt = formatDistance(
    new Date(notification.createdAt),
    currentTime,
    { addSuffix: true }
  )

  // Line 1 (the notification text), the per-kind body below it, and the
  // whole-row link to the subject post (when there is one).
  let line1: ReactNode = (
    <span className="text-muted-foreground">
      This notification is no longer available.
    </span>
  )
  let body: ReactNode = null
  // The whole-row overlay's href. Usually the subject post, but a `plain` row
  // has no post and points at the surface it is about instead.
  let statusPath: string | null = null
  // Status rows and `plain` rows have no inner link of their own, so their
  // whole-row overlay must be reachable by keyboard / assistive tech. Activity
  // imports expose a "View" link, so their overlay stays decorative
  // (aria-hidden) to avoid a redundant tab stop.
  let overlayAccessible = false

  if (cfg && withAccount) {
    const acc = withAccount.account
    const name = acc.display_name || acc.username

    if (cfg.kind === 'status') {
      // An emoji reaction names the emoji it was made with; every other status
      // type just states the verb.
      const verb =
        notification.type === 'emoji_reaction' && notification.reactionName
          ? `reacted with ${notification.reactionName} to your post`
          : cfg.verb
      line1 = <span className="text-muted-foreground">{verb}</span>
      const withStatus = hasStatusActor(withAccount) ? withAccount : null
      if (withStatus) {
        statusPath = getNotificationStatusPath(withStatus.status)
        overlayAccessible = true
        body = (
          <StatusNotification
            host={host}
            notification={withStatus}
            emphasizePreview={
              notification.type === 'mention' || notification.type === 'reply'
            }
          />
        )
      } else {
        body = (
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            This post is no longer available.
          </p>
        )
      }
    } else if (cfg.kind === 'relationship') {
      line1 = (
        <span className="text-muted-foreground">
          <Link
            href={`/@${acc.acct}`}
            prefetch={false}
            className="font-semibold text-foreground hover:underline"
          >
            <ActorDisplayName
              name={getGroupedName(name, notification.groupedCount)}
              emojis={acc.emojis}
            />
          </Link>{' '}
          {cfg.verb}
        </span>
      )
      if (notification.type === 'follow') {
        body = <FollowNotification account={acc} />
      } else if (notification.type === 'follow_request') {
        body = (
          <FollowRequestNotification
            // Re-key on the server-resolved status so a request handled
            // elsewhere (and surfaced on a soft refresh) re-seeds the row
            // instead of keeping the mount-time state. This NotificationItem is
            // already keyed by notification.id upstream, so keying by id here
            // would never reset; the resolved status is what must reset it.
            key={notification.followRequestStatus ?? 'pending'}
            account={acc}
            initialStatus={notification.followRequestStatus}
          />
        )
      } else if (notification.type === 'added_to_collection') {
        // The consent gate: let the member choose whether to appear on the
        // collection's public link. Needs the collection (from the groupKey)
        // and the viewer's own account id; without either, show just the verb.
        body =
          notification.collection && currentAccountId ? (
            <CollectionConsentNotification
              collectionId={notification.collection.id}
              collectionTitle={notification.collection.title}
              accountId={currentAccountId}
            />
          ) : null
      }
      // collection_update is informational — the verb on line 1 is the whole row.
    } else if (cfg.kind === 'plain') {
      // A notice about the account's own data. It carries no status by design,
      // so it must not go through the 'system' branch below — that one reads a
      // missing status as a DELETED one and would tell every gear reminder that
      // "This imported activity is no longer available."
      //
      // The row links to the gear list rather than the specific gear: the
      // notification record has no room for the gear id. The email that
      // accompanies it does deep-link to the gear.
      line1 = <span className="font-semibold text-foreground">{cfg.verb}</span>
      statusPath = '/fitness/gear'
      overlayAccessible = true
    } else {
      line1 = <span className="font-semibold text-foreground">{cfg.verb}</span>
      const withStatus = hasStatusActor(withAccount) ? withAccount : null
      if (withStatus) {
        statusPath = getNotificationStatusPath(withStatus.status)
        body = (
          <ActivityImportNotification host={host} notification={withStatus} />
        )
      } else {
        body = (
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            This imported activity is no longer available.
          </p>
        )
      }
    }
  }

  const showBadge = Boolean(cfg && withAccount)
  // A `plain` row is self-addressed, so its account IS the recipient — naming
  // them would have a screen reader announce "Alice Wonder Your gear is due for
  // service" for a row whose visible text is just the verb. Its overlay is also
  // the row's only focusable element, so that label is all assistive tech gets.
  const overlayLabel =
    cfg?.kind === 'plain'
      ? cfg.verb
      : cfg && account
        ? `${getGroupedName(account.display_name || account.username, notification.groupedCount)} ${cfg.verb}`
        : 'Open notification'

  return (
    <div
      ref={elementRef}
      data-notification-id={notification.id}
      data-grouped-ids={notification.groupedIds?.join(',') || notification.id}
      className={cn(
        'relative border-l-[3px] px-4 py-3.5 transition-colors',
        isRead
          ? 'border-l-transparent hover:bg-muted/40'
          : 'border-l-primary bg-primary/[0.04] hover:bg-primary/[0.06]'
      )}
    >
      {!isRead && <span className="sr-only">Unread</span>}
      {statusPath &&
        // Whole-row link to whatever the row is about — the subject post, or
        // the gear page for a `plain` row. For those two it is the only link,
        // so it stays focusable; activity-import rows have an explicit "View"
        // link, so theirs is hidden from the tab order / SR to avoid a
        // duplicate stop while keeping the full-row mouse target.
        (overlayAccessible ? (
          <Link
            href={statusPath}
            prefetch={false}
            aria-label={overlayLabel}
            className="absolute inset-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
          />
        ) : (
          <Link
            href={statusPath}
            prefetch={false}
            aria-hidden="true"
            tabIndex={-1}
            className="absolute inset-0"
          />
        ))}
      <div
        className={cn(
          'relative z-10 flex gap-3',
          // Neutralise pointer events only when the overlay link is present, so
          // it catches clicks on empty areas while inner links / buttons stay
          // interactive. Without an overlay (relationship rows) leave normal
          // pointer behaviour and text selection.
          statusPath &&
            'pointer-events-none [&_a]:pointer-events-auto [&_button]:pointer-events-auto'
        )}
      >
        {showBadge && <NotificationTypeBadge type={notification.type} />}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 text-sm leading-snug">{line1}</div>
            <time
              dateTime={new Date(notification.createdAt).toISOString()}
              className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground"
            >
              {relativeCreatedAt}
            </time>
          </div>
          {body}
        </div>
      </div>
    </div>
  )
}
