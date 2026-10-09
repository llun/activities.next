'use client'

import { UTCDate } from '@date-fns/utc'
import { formatDistance } from 'date-fns/formatDistance'
import { formatRelative } from 'date-fns/formatRelative'
import { Clock, Monitor, Trash2 } from 'lucide-react'
import { FC, useMemo, useRef, useState } from 'react'

import { LogoutButton } from '@/app/(timeline)/account/LogoutButton'
import { formatConnectedAppMeta } from '@/app/(timeline)/account/sessions/connectedAppMeta'
import {
  deleteSession,
  revokeConnectedApp,
  revokeOtherSessions
} from '@/lib/client'
import { PageHeader } from '@/lib/components/page-header'
import { Alert } from '@/lib/components/surface/Alert'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import { FormRow } from '@/lib/components/surface/FormRow'
import { Frame } from '@/lib/components/surface/Frame'
import { FramedList, FramedListItem } from '@/lib/components/surface/FramedList'
import { Section } from '@/lib/components/surface/Section'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { Badge } from '@/lib/components/ui/badge'
import { Button } from '@/lib/components/ui/button'
import { useHasHydrated } from '@/lib/hooks/useHasHydrated'
import { cn } from '@/lib/utils'

export interface SessionActor {
  id: string
  name: string
  handle: string
  iconUrl: string | null
}

export interface AccountSessionRow {
  // `sessions.id`. The session token is the credential behind the session
  // cookie and must never be sent to the browser.
  id: string
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
  // Epoch ms (never a Date, see "Date Serialization in Server Components");
  // rendered relative to `currentTime`, so SSR and hydration agree.
  authorizedAt: number
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
  <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
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
  const hasHydrated = useHasHydrated()
  const [sessionList, setSessionList] = useState(sessions)
  const [appList, setAppList] = useState(apps)
  const [error, setError] = useState<string>()
  // Serialize revokes: with optimistic removal + rollback-on-failure,
  // overlapping requests could resurrect an already-revoked row when a slow
  // failure rolls back over a newer success. `pendingRef` is a SYNCHRONOUS
  // re-entrancy lock — two clicks in the same tick can both pass a `busy` state
  // check (state updates are async), but only the first sees `pendingRef`
  // unset. `busy` then drives the disabled UI.
  const pendingRef = useRef(false)
  const [busy, setBusy] = useState(false)

  const others = sessionList.filter((session) => !session.current)
  const actorCount = new Set(
    [...sessionList, ...appList].map(
      (item) => item.actor?.id ?? UNKNOWN_GROUP_ID
    )
  ).size

  // Run an optimistic revoke under the synchronous lock: apply the optimistic
  // update, call the API, and restore + surface an error if it fails.
  const runRevoke = async (
    optimistic: () => void,
    request: () => Promise<boolean>,
    rollback: () => void,
    failureMessage: string
  ) => {
    if (pendingRef.current) return
    pendingRef.current = true
    setBusy(true)
    setError(undefined)
    optimistic()
    try {
      // The client fns signal failure by returning false; a network error
      // rejects instead. Treat both the same — roll the optimistic update back
      // and surface the error — by throwing on a false result and handling it
      // alongside a rejection in one catch.
      if (!(await request())) throw new Error(failureMessage)
    } catch {
      rollback()
      setError(failureMessage)
    } finally {
      pendingRef.current = false
      setBusy(false)
    }
  }

  const revokeSession = (id: string) => {
    const previous = sessionList
    return runRevoke(
      () =>
        setSessionList((list) => list.filter((session) => session.id !== id)),
      () => deleteSession({ id }),
      () => setSessionList(previous),
      'Failed to revoke that session. Please try again.'
    )
  }

  const revokeAll = () => {
    const previous = sessionList
    return runRevoke(
      () => setSessionList((list) => list.filter((session) => session.current)),
      () => revokeOtherSessions(),
      () => setSessionList(previous),
      'Failed to revoke the other sessions. Please try again.'
    )
  }

  const revokeApp = (clientId: string, actorId: string | null) => {
    const previous = appList
    return runRevoke(
      () =>
        setAppList((list) =>
          list.filter(
            (app) => !(app.clientId === clientId && app.actorId === actorId)
          )
        ),
      () => revokeConnectedApp({ clientId, actorId }),
      () => setAppList(previous),
      'Failed to revoke that app. Please try again.'
    )
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
              account. Sorted with the most recent first.
            </p>
            <p>
              {sessionCount} active{' '}
              {sessionCount === 1 ? 'session' : 'sessions'} and {appCount}{' '}
              connected {appCount === 1 ? 'app' : 'apps'} across {actorCount}{' '}
              {actorCount === 1 ? 'actor' : 'actors'}.
            </p>
          </>
        }
        stackActionsOnMobile
        actions={
          others.length > 0 ? (
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
          )
        }
      />

      {error && <Alert title={error} />}

      {groups.map((group) => (
        <Section
          key={group.id}
          title={
            <span className="flex min-w-0 items-center gap-2">
              <ActorAvatar actor={group.actor} className="size-7" />
              <span className="truncate">
                {group.actor?.name || 'Other sessions'}
              </span>
            </span>
          }
          meta={
            <>
              {group.actor ? <span>{group.actor.handle} · </span> : null}
              {groupSummary(group)}
            </>
          }
        >
          <FramedList aria-label={group.actor?.name || 'Other sessions'}>
            {group.sessions.map((session) => {
              const remaining = session.expireAt - currentTime
              // Guard against a negative remaining time so an already-expired
              // session can never be mislabeled "Expiring soon".
              const soon =
                !session.current && remaining > 0 && remaining < SOON_MS
              return (
                <FramedListItem
                  key={session.id}
                  className={cn(
                    'flex items-start gap-3',
                    session.current && 'bg-primary/5'
                  )}
                >
                  <span
                    className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-md',
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
                    {/* formatRelative prints a clock time and picks "today"
                        or "yesterday" by calendar day, both in a time zone the
                        server does not know: UTC until hydrated, then the
                        reader's own. */}
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      Signed in{' '}
                      {hasHydrated
                        ? formatRelative(session.createdAt, currentTime)
                        : formatRelative(
                            new UTCDate(session.createdAt),
                            new UTCDate(currentTime)
                          )}
                    </div>
                    <div
                      className={cn(
                        'mt-1 flex items-center gap-1.5 text-xs',
                        soon ? 'text-destructive-text' : 'text-muted-foreground'
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
                      onClick={() => revokeSession(session.id)}
                      disabled={busy}
                    >
                      Revoke
                    </Button>
                  )}
                </FramedListItem>
              )
            })}

            {group.apps.map((app) => (
              <FramedListItem
                key={`${app.clientId}:${app.actorId ?? ''}`}
                className="flex items-start gap-3"
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-xs font-semibold text-white"
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
                    {formatConnectedAppMeta({
                      website: app.website,
                      signIn: app.signIn,
                      authorizedAt: app.authorizedAt,
                      currentTime
                    })}
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
              </FramedListItem>
            ))}
          </FramedList>
        </Section>
      ))}

      {groups.length === 0 && (
        <EmptyState icon={Monitor} title="No active sessions found">
          Sign-ins and connected apps show up here, where you can revoke them.
        </EmptyState>
      )}

      <Section
        title="This device"
        description="End the session you’re using right now. You’ll be returned to the sign-in screen."
      >
        <Frame>
          <FormRow
            label="Sign out of this device"
            hint="You can sign in again at any time."
          >
            {({ describedBy }) => <LogoutButton describedBy={describedBy} />}
          </FormRow>
        </Frame>
      </Section>
    </div>
  )
}
