'use client'

import { formatDistance, formatRelative } from 'date-fns'
import { Clock, Monitor, Trash2 } from 'lucide-react'
import { FC, useMemo, useState } from 'react'

import { LogoutButton } from '@/app/(timeline)/account/LogoutButton'
import {
  deleteSession,
  revokeConnectedApp,
  revokeOtherSessions
} from '@/lib/client'
import { PageHeader } from '@/lib/components/page-header'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { Badge } from '@/lib/components/ui/badge'
import { Button } from '@/lib/components/ui/button'
import { cn } from '@/lib/utils'

export interface SessionActor {
  id: string
  name: string
  handle: string
  iconUrl: string | null
}

export interface AccountSessionRow {
  token: string
  actor: SessionActor | null
  createdAt: number
  expireAt: number
  current: boolean
}

export interface AccountAppRow {
  clientId: string
  // The raw consent referenceId, used to scope a revoke. Kept separate from the
  // resolved `actor` because a referenceId may not resolve to a known actor.
  actorId: string | null
  actor: SessionActor | null
  name: string | null
  website: string | null
  scopes: string[]
  // Preformatted on the server so the absolute date can't cause an SSR/client
  // timezone hydration mismatch.
  authorizedLabel: string
  signIn: boolean
}

interface Props {
  currentTime: number
  sessions: AccountSessionRow[]
  apps: AccountAppRow[]
}

// Flag a session whose expiry is within a day so it stands out before it lapses.
const SOON_MS = 24 * 60 * 60 * 1000
const UNKNOWN_GROUP_ID = '__unknown__'

// Stable monogram background for a connected app, derived from its client id so
// the same app always renders the same colour without storing one.
const APP_COLORS = [
  '#1c7ed6',
  '#0c8599',
  '#7048e8',
  '#e8590c',
  '#2f9e44',
  '#c2255c',
  '#5f3dc4'
]
const appColor = (seed: string) => {
  let hash = 0
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0
  }
  return APP_COLORS[Math.abs(hash) % APP_COLORS.length]
}

const initials = (value: string) =>
  value
    .replace(/^@/, '')
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    // Spread to a code-point array so a leading emoji / non-BMP character isn't
    // split through its surrogate pair.
    .map((part) => [...part][0]?.toUpperCase() ?? '')
    .join('') || '?'

const ActorAvatar: FC<{ actor: SessionActor | null; className: string }> = ({
  actor,
  className
}) => (
  // Decorative: the actor's name and handle are shown as text next to it, so
  // hide the initials avatar from screen readers to avoid redundant narration.
  <Avatar className={className} aria-hidden="true">
    {actor?.iconUrl && <AvatarImage src={actor.iconUrl} alt="" />}
    <AvatarFallback className="bg-muted text-xs text-muted-foreground">
      {initials(actor?.name || actor?.handle || 'Unknown')}
    </AvatarFallback>
  </Avatar>
)

const ScopePill: FC<{ children: string }> = ({ children }) => (
  <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
    {children}
  </span>
)

interface Group {
  id: string
  actor: SessionActor | null
  sessions: AccountSessionRow[]
  apps: AccountAppRow[]
}

const groupSummary = (group: Group) => {
  const parts: string[] = []
  if (group.sessions.length) {
    parts.push(
      `${group.sessions.length} ${group.sessions.length === 1 ? 'session' : 'sessions'}`
    )
  }
  if (group.apps.length) {
    parts.push(
      `${group.apps.length} ${group.apps.length === 1 ? 'app' : 'apps'}`
    )
  }
  return parts.join(' · ')
}

export const AccountSessions: FC<Props> = ({ currentTime, sessions, apps }) => {
  const [sessionList, setSessionList] = useState(sessions)
  const [appList, setAppList] = useState(apps)
  const [error, setError] = useState<string>()
  // Serialize revokes: with optimistic removal + rollback-on-failure,
  // overlapping requests could resurrect an already-revoked row when a slow
  // failure rolls back over a newer success. Disabling every revoke control
  // while one is in flight rules that interleaving out entirely.
  const [busy, setBusy] = useState(false)

  const others = sessionList.filter((session) => !session.current)
  const actorCount = new Set(
    [...sessionList, ...appList].map(
      (item) => item.actor?.id ?? UNKNOWN_GROUP_ID
    )
  ).size

  const revokeSession = async (token: string) => {
    if (busy) return
    setError(undefined)
    setBusy(true)
    const previous = sessionList
    setSessionList((list) => list.filter((session) => session.token !== token))
    try {
      if (!(await deleteSession({ token }))) {
        setSessionList(previous)
        setError('Failed to revoke that session. Please try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  const revokeAll = async () => {
    if (busy) return
    setError(undefined)
    setBusy(true)
    const previous = sessionList
    setSessionList((list) => list.filter((session) => session.current))
    try {
      if (!(await revokeOtherSessions())) {
        setSessionList(previous)
        setError('Failed to revoke the other sessions. Please try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  const revokeApp = async (clientId: string, actorId: string | null) => {
    if (busy) return
    setError(undefined)
    setBusy(true)
    const previous = appList
    setAppList((list) =>
      list.filter(
        (app) => !(app.clientId === clientId && app.actorId === actorId)
      )
    )
    try {
      if (!(await revokeConnectedApp({ clientId, actorId }))) {
        setAppList(previous)
        setError('Failed to revoke that app. Please try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  // Group sessions and apps by their actor; the group that holds the current
  // session floats to the top so "this device" leads.
  const groups = useMemo<Group[]>(() => {
    const byId = new Map<string, Group>()
    const order: string[] = []
    const ensure = (actor: SessionActor | null) => {
      const id = actor?.id ?? UNKNOWN_GROUP_ID
      let group = byId.get(id)
      if (!group) {
        group = { id, actor, sessions: [], apps: [] }
        byId.set(id, group)
        order.push(id)
      }
      return group
    }
    sessionList.forEach((session) =>
      ensure(session.actor).sessions.push(session)
    )
    appList.forEach((app) => ensure(app.actor).apps.push(app))
    const hasCurrent = (id: string) =>
      byId.get(id)?.sessions.some((session) => session.current) ?? false
    order.sort((a, b) => (hasCurrent(b) ? 1 : 0) - (hasCurrent(a) ? 1 : 0))
    return order.map((id) => byId.get(id) as Group)
  }, [sessionList, appList])

  const sessionCount = sessionList.length
  const appCount = appList.length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sessions"
        description={
          <>
            <p>
              Review where you&apos;re signed in and the apps connected to your
              account.
            </p>
            <p>
              {sessionCount} active{' '}
              {sessionCount === 1 ? 'session' : 'sessions'} and {appCount}{' '}
              connected {appCount === 1 ? 'app' : 'apps'} across {actorCount}{' '}
              {actorCount === 1 ? 'actor' : 'actors'}.
            </p>
          </>
        }
      />

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Sorted with the most recent first.
        </p>
        {others.length > 0 ? (
          <Button
            variant="outline"
            size="sm"
            onClick={revokeAll}
            disabled={busy}
          >
            <Trash2 className="h-4 w-4" />
            Revoke all others
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">
            No other active sessions
          </span>
        )}
      </div>

      {groups.map((group) => (
        <section
          key={group.id}
          className="overflow-hidden rounded-2xl border bg-background/80 shadow-sm"
        >
          <div className="flex items-center gap-3 border-b bg-muted/40 px-4 py-3">
            <ActorAvatar actor={group.actor} className="h-8 w-8" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">
                {group.actor?.name || 'Other sessions'}
              </div>
              {group.actor && (
                <div className="truncate text-xs text-muted-foreground">
                  {group.actor.handle}
                </div>
              )}
            </div>
            <span className="text-xs text-muted-foreground">
              {groupSummary(group)}
            </span>
          </div>

          <div className="divide-y">
            {group.sessions.map((session) => {
              const remaining = session.expireAt - currentTime
              // Guard against a negative remaining time so an already-expired
              // session can never be mislabeled "Expiring soon".
              const soon =
                !session.current && remaining > 0 && remaining < SOON_MS
              return (
                <div
                  key={session.token}
                  className={cn(
                    'flex items-start gap-3 px-4 py-4',
                    session.current && 'bg-primary/5'
                  )}
                >
                  <span
                    className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                      session.current
                        ? 'bg-primary/10 text-primary'
                        : 'bg-muted text-muted-foreground'
                    )}
                  >
                    <Monitor className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-medium">Web session</span>
                      {session.current && (
                        <Badge tone="primary">This device</Badge>
                      )}
                      {soon && <Badge tone="destructive">Expiring soon</Badge>}
                    </div>
                    {/* formatRelative renders a localized clock time, which
                        differs between the server and client timezones; suppress
                        the hydration warning (matching MessageBubble /
                        AnnouncementBanner) so the client's local time wins. */}
                    <div
                      className="mt-0.5 text-xs text-muted-foreground"
                      suppressHydrationWarning
                    >
                      Signed in {formatRelative(session.createdAt, currentTime)}
                    </div>
                    <div
                      className={cn(
                        'mt-1 flex items-center gap-1.5 text-xs',
                        soon ? 'text-destructive' : 'text-muted-foreground'
                      )}
                    >
                      <Clock className="h-3.5 w-3.5" />
                      <span>
                        Expires in{' '}
                        {formatDistance(session.expireAt, currentTime)}
                      </span>
                    </div>
                  </div>
                  {!session.current && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => revokeSession(session.token)}
                      disabled={busy}
                    >
                      Revoke
                    </Button>
                  )}
                </div>
              )
            })}

            {group.apps.map((app) => (
              <div
                key={`${app.clientId}:${app.actorId ?? ''}`}
                className="flex items-start gap-3 px-4 py-4"
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-semibold text-white"
                  style={{ background: appColor(app.clientId) }}
                  aria-hidden="true"
                >
                  {initials(app.name || app.clientId)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-medium">
                      {app.name || app.clientId}
                    </span>
                    {app.signIn ? (
                      <Badge tone="blue">Sign-in</Badge>
                    ) : (
                      <Badge tone="gray">App</Badge>
                    )}
                  </div>
                  {app.scopes.length > 0 && (
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {app.scopes.map((scope) => (
                        <ScopePill key={scope}>{scope}</ScopePill>
                      ))}
                    </div>
                  )}
                  <div className="mt-1.5 truncate text-xs text-muted-foreground">
                    {app.website ? `${app.website} · ` : ''}
                    {app.signIn ? 'Signs you in' : 'Authorized'}{' '}
                    {app.authorizedLabel}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => revokeApp(app.clientId, app.actorId)}
                  disabled={busy}
                >
                  Revoke
                </Button>
              </div>
            ))}
          </div>
        </section>
      ))}

      {groups.length === 0 && (
        <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          No active sessions found.
        </div>
      )}

      <section className="space-y-4 rounded-2xl border bg-background/80 p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">This device</h2>
          <p className="text-sm text-muted-foreground">
            End the session you&apos;re using right now. You&apos;ll be returned
            to the sign-in screen.
          </p>
        </div>
        <LogoutButton />
      </section>
    </div>
  )
}
