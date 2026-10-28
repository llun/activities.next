'use client'

import { formatDistance } from 'date-fns/formatDistance'
import { Archive, Download } from 'lucide-react'
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'

import {
  AccountArchiveResponse,
  listAccountArchives,
  requestAccountArchive
} from '@/lib/client/accountArchives'
import { onConnectionRestored } from '@/lib/client/connection'
import { listDrafts } from '@/lib/client/drafts/draftsDb'
import type { DraftRecord } from '@/lib/client/drafts/types'
import { ApiRequestError } from '@/lib/client/http'
import { ActorChangedAlert } from '@/lib/components/settings/ActorChangedAlert'
import { Alert } from '@/lib/components/surface/Alert'
import { Frame } from '@/lib/components/surface/Frame'
import { Section } from '@/lib/components/surface/Section'
import { Button } from '@/lib/components/ui/button'
import { Progress } from '@/lib/components/ui/progress'
import { Switch } from '@/lib/components/ui/switch'
import { useConnectionStatus } from '@/lib/hooks/useConnectionStatus'
import { useHasHydrated } from '@/lib/hooks/useHasHydrated'
import { formatBytes } from '@/lib/utils/formatBytes'

const DRAFTS_MAX_BYTES = 5 * 1024 * 1024
const POLL_INTERVAL_MS = 10_000

interface Props {
  actorId: string
  currentTime: number
  initialArchives: AccountArchiveResponse[]
  exportAvailable: boolean
}

const parseTimestamp = (value: string | null | undefined) => {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : time
}

// The MovingDate pattern: the server cannot know the viewer's zone, so the
// dates render in UTC until hydration and in the viewer's zone after it.
const formatDate = (value: string, utc: boolean) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: utc ? 'UTC' : undefined,
    year: 'numeric'
  }).format(new Date(value))

const formatDateTime = (value: string, utc: boolean) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: 'short',
    timeZone: utc ? 'UTC' : undefined,
    year: 'numeric'
  }).format(new Date(value))

const isActive = (archive: AccountArchiveResponse | undefined) =>
  archive?.status === 'queued' || archive?.status === 'running'

const isArchiveResponse = (value: unknown): value is AccountArchiveResponse =>
  Boolean(
    value &&
    typeof value === 'object' &&
    'id' in value &&
    'status' in value &&
    'createdAt' in value
  )

const archiveCooldown = (archives: AccountArchiveResponse[]) => {
  const lastRequested = archives.find((archive) => archive.status !== 'failed')
  const createdAt = parseTimestamp(lastRequested?.createdAt)
  return createdAt === null ? null : createdAt + 7 * 24 * 60 * 60 * 1000
}

export const ArchiveExportSection = ({
  actorId,
  currentTime,
  initialArchives,
  exportAvailable
}: Props) => {
  const [archives, setArchives] = useState(initialArchives)
  const [includeDrafts, setIncludeDrafts] = useState(false)
  const [stripExactLocations, setStripExactLocations] = useState(false)
  const [drafts, setDrafts] = useState<DraftRecord[]>([])
  const [draftsLoaded, setDraftsLoaded] = useState(false)
  const [draftReadError, setDraftReadError] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [actorChanged, setActorChanged] = useState(false)
  const [rateLimitUntil, setRateLimitUntil] = useState<number | null>(null)
  const [clock, setClock] = useState(currentTime)
  const hasHydrated = useHasHydrated()
  const isOffline = useConnectionStatus().state === 'offline'

  const currentArchive = archives[0]
  const archiveStatus =
    currentArchive?.status === 'ready' &&
    currentArchive.expiresAt &&
    (parseTimestamp(currentArchive.expiresAt) ?? Infinity) <= clock
      ? 'expired'
      : currentArchive?.status
  const active = isActive(currentArchive)
  const cooldownUntil = Math.max(
    archiveCooldown(archives) ?? 0,
    rateLimitUntil ?? 0
  )
  const coolingDown = cooldownUntil > clock

  const draftsBytes = useMemo(() => {
    try {
      return new TextEncoder().encode(JSON.stringify(drafts)).byteLength
    } catch {
      return DRAFTS_MAX_BYTES + 1
    }
  }, [drafts])
  const draftsTooLarge = draftsBytes > DRAFTS_MAX_BYTES

  useEffect(() => {
    if (!hasHydrated || !exportAvailable) return

    let cancelled = false
    setDraftsLoaded(false)
    setDraftReadError(false)
    void listDrafts({ actorId })
      .then((stored) => {
        if (!cancelled) setDrafts(stored)
      })
      .catch(() => {
        if (!cancelled) {
          setDrafts([])
          setDraftReadError(true)
        }
      })
      .finally(() => {
        if (!cancelled) setDraftsLoaded(true)
      })

    return () => {
      cancelled = true
    }
  }, [actorId, exportAvailable, hasHydrated])

  useEffect(() => {
    if (cooldownUntil <= Date.now()) return
    const timer = window.setTimeout(
      () => setClock(Date.now()),
      cooldownUntil - Date.now()
    )
    return () => window.clearTimeout(timer)
  }, [cooldownUntil])

  const refreshArchives = useCallback(async () => {
    try {
      const latest = await listAccountArchives({ actorId })
      setArchives(latest)
      setActorChanged(false)
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) {
        setActorChanged(true)
      }
    }
  }, [actorId])

  useEffect(() => {
    if (!active || isOffline) return
    const timer = window.setInterval(
      () => void refreshArchives(),
      POLL_INTERVAL_MS
    )
    return () => window.clearInterval(timer)
  }, [active, isOffline, refreshArchives])

  useEffect(() => {
    if (!active) return
    return onConnectionRestored(() => void refreshArchives())
  }, [active, refreshArchives])

  const prepareArchive = useCallback(async () => {
    if (!exportAvailable || active || requesting || coolingDown || isOffline)
      return
    if (includeDrafts && draftsTooLarge) return

    setRequesting(true)
    setRequestError(null)
    setActorChanged(false)
    try {
      const archive = await requestAccountArchive({
        actorId,
        stripExactLocations,
        ...(includeDrafts ? { drafts } : null)
      })
      setArchives((previous) => [
        archive,
        ...previous.filter((item) => item.id !== archive.id)
      ])
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) {
        setActorChanged(true)
      } else if (error instanceof ApiRequestError && error.status === 429) {
        const nextAllowedAt = error.details?.nextAllowedAt
        const parsed =
          typeof nextAllowedAt === 'string'
            ? parseTimestamp(nextAllowedAt)
            : null
        if (parsed !== null) {
          setRateLimitUntil(parsed)
          setClock(Date.now())
        }
        const archive = error.details?.archive
        if (isArchiveResponse(archive)) {
          setArchives((previous) => [
            archive,
            ...previous.filter((item) => item.id !== archive.id)
          ])
        }
      } else {
        setRequestError(
          error instanceof Error
            ? error.message
            : 'Could not prepare your archive'
        )
      }
    } finally {
      setRequesting(false)
    }
  }, [
    actorId,
    active,
    coolingDown,
    drafts,
    draftsTooLarge,
    exportAvailable,
    includeDrafts,
    isOffline,
    requesting,
    stripExactLocations
  ])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void prepareArchive()
  }

  const createdAt = currentArchive?.createdAt
  const expiresAt = currentArchive?.expiresAt
  const expiryCopy = expiresAt
    ? hasHydrated
      ? `The download link expires in ${formatDistance(
          new Date(expiresAt),
          new Date(clock)
        )} (${formatDate(expiresAt, !hasHydrated)}).`
      : `The download link expires on ${formatDate(expiresAt, true)}.`
    : null

  const failedAlert = archiveStatus === 'failed' && currentArchive
  const archiveError = failedAlert
    ? 'Something went wrong while packing your photos. Your last request does not count; try again.'
    : null

  return (
    <div className="space-y-4">
      {actorChanged ? <ActorChangedAlert /> : null}
      {!exportAvailable ? (
        <Alert
          tone="info"
          title="Archive export is not available on this server"
          live={false}
        />
      ) : null}
      {archiveError ? (
        <Alert
          tone="error"
          title="We could not make your archive"
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={requesting || isOffline}
              onClick={() => void prepareArchive()}
            >
              Try again
            </Button>
          }
        >
          {archiveError}
        </Alert>
      ) : null}
      {requestError ? (
        <Alert
          tone="error"
          title="We could not make your archive"
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={requesting || isOffline}
              onClick={() => void prepareArchive()}
            >
              Try again
            </Button>
          }
        >
          {requestError}
        </Alert>
      ) : null}

      <Section
        title="Download your archive"
        icon={Archive}
        description="Everything on your account in one ZIP file. Mastodon and other servers can read the posts; fitness files, gallery and settings are extra."
      >
        <Frame>
          <form
            data-testid="archive-export-form"
            onSubmit={submit}
            className="space-y-5 p-4 sm:p-5"
          >
            {/* A polite live region: the change from "being prepared" to
                "Ready" (or expired, or failed) is the news, and it happens
                after the page has settled. */}
            <div role="status" className="space-y-2">
              <p className="text-sm font-medium">Latest archive</p>
              {archiveStatus === 'ready' && currentArchive ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <p className="font-medium">
                      activities-archive-{currentArchive.id.slice(0, 8)}.zip
                    </p>
                    <span className="rounded-full bg-success-surface px-2 py-0.5 text-xs font-medium text-success-text">
                      Ready
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {currentArchive.bytes === null
                      ? 'Size unavailable'
                      : formatBytes(currentArchive.bytes)}
                    {createdAt
                      ? ` · made ${formatDateTime(createdAt, !hasHydrated)}`
                      : ''}
                  </p>
                  {expiryCopy ? (
                    <p className="text-sm text-muted-foreground">
                      {expiryCopy}
                    </p>
                  ) : null}
                  {currentArchive.downloadUrl ? (
                    <Button asChild variant="outline" size="sm">
                      <a href={currentArchive.downloadUrl}>
                        <Download aria-hidden="true" />
                        Download
                      </a>
                    </Button>
                  ) : null}
                </div>
              ) : archiveStatus === 'expired' ? (
                <div className="space-y-1">
                  <p className="font-medium">Your last archive has expired</p>
                  {createdAt ? (
                    <p className="text-sm text-muted-foreground">
                      Made {formatDate(createdAt, !hasHydrated)}. Links work for
                      7 days.
                    </p>
                  ) : null}
                  <p className="text-sm text-muted-foreground">Expired</p>
                  <p className="text-sm text-muted-foreground">
                    Ready to make a new one.
                  </p>
                </div>
              ) : archiveStatus === 'queued' || archiveStatus === 'running' ? (
                <div className="space-y-2">
                  <p className="font-medium">Your archive is being prepared</p>
                  {createdAt ? (
                    <p className="text-sm text-muted-foreground">
                      Started {formatDateTime(createdAt, !hasHydrated)}
                    </p>
                  ) : null}
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium">Being prepared</span>
                  </div>
                  <Progress aria-label="Archive export progress" />
                  <p className="text-sm text-muted-foreground">
                    You can leave this page. We email you when it is ready, and
                    the download link shows up here.
                  </p>
                </div>
              ) : archiveStatus === 'failed' ? (
                <p className="text-sm text-muted-foreground">
                  Your archive could not be prepared.
                </p>
              ) : (
                <div className="space-y-1">
                  <p className="font-medium">No archive yet</p>
                  <p className="text-sm text-muted-foreground">
                    Make your first archive below. It usually takes a few
                    minutes.
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-3 border-t pt-4">
              <h3 className="text-sm font-semibold">What is included</h3>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="font-medium">Posts and media</dt>
                  <dd className="text-muted-foreground">
                    Posts, photos and videos
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">Fitness files</dt>
                  <dd className="text-muted-foreground">
                    Original FIT, GPX and TCX files, with gear
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">Gallery and albums</dt>
                  <dd className="text-muted-foreground">
                    Albums, with photo details
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">Profiles on every domain</dt>
                  <dd className="text-muted-foreground">
                    Your profiles on every domain
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">Followers and following</dt>
                  <dd className="text-muted-foreground">
                    Lists, mutes and blocks
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">Settings</dt>
                  <dd className="text-muted-foreground">
                    Profile, privacy, navigation and notifications
                  </dd>
                </div>
              </dl>
              <p className="text-sm text-muted-foreground">
                Private posts and direct messages are included, so keep the file
                safe. Passwords, sign-in sessions and your Strava and Wahoo
                connections are never included.
              </p>
            </div>

            <div className="space-y-4 border-t pt-4">
              {hasHydrated && draftsLoaded ? (
                <div className="flex items-start gap-4">
                  <div className="min-w-0 flex-1 space-y-1">
                    <label
                      htmlFor="include-archive-drafts"
                      className="text-sm font-medium"
                    >
                      Include drafts from this browser
                    </label>
                    <p
                      id="include-archive-drafts-hint"
                      className="text-sm text-muted-foreground"
                    >
                      {draftReadError
                        ? 'Drafts could not be read from this browser.'
                        : `Drafts are saved in this browser only, so they are added from here (${drafts.length} ${drafts.length === 1 ? 'draft' : 'drafts'}). Off by default: drafts can be half-written.`}
                    </p>
                    {draftsTooLarge ? (
                      <p className="text-sm text-destructive-text">
                        These drafts are over the 5 MiB export limit and can’t
                        be included.
                      </p>
                    ) : null}
                  </div>
                  <Switch
                    id="include-archive-drafts"
                    aria-label="Include drafts from this browser"
                    aria-describedby="include-archive-drafts-hint"
                    checked={includeDrafts}
                    disabled={
                      active ||
                      drafts.length === 0 ||
                      draftsTooLarge ||
                      draftReadError
                    }
                    onCheckedChange={setIncludeDrafts}
                  />
                </div>
              ) : null}

              <div className="flex items-start gap-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <label
                    htmlFor="strip-exact-locations"
                    className="text-sm font-medium"
                  >
                    Leave out exact photo locations
                  </label>
                  <p
                    id="strip-exact-locations-hint"
                    className="text-sm text-muted-foreground"
                  >
                    Photos keep their place name but lose the exact spot. Handy
                    if you will share the archive.
                  </p>
                </div>
                <Switch
                  id="strip-exact-locations"
                  aria-label="Leave out exact photo locations"
                  aria-describedby="strip-exact-locations-hint"
                  checked={stripExactLocations}
                  disabled={active}
                  onCheckedChange={setStripExactLocations}
                />
              </div>
            </div>

            {coolingDown && !active ? (
              <p className="border-t pt-4 text-sm text-muted-foreground">
                You can make another archive on{' '}
                {formatDate(
                  new Date(cooldownUntil).toISOString(),
                  !hasHydrated
                )}
                . One every 7 days.
              </p>
            ) : null}
            {isOffline ? (
              <p className="text-sm text-muted-foreground">You’re offline.</p>
            ) : null}
            {exportAvailable && archiveStatus !== 'failed' ? (
              <div className="flex justify-end border-t pt-4">
                <Button
                  type="submit"
                  disabled={
                    active ||
                    coolingDown ||
                    requesting ||
                    isOffline ||
                    (includeDrafts && draftsTooLarge)
                  }
                >
                  {requesting
                    ? 'Preparing…'
                    : active
                      ? 'Preparing…'
                      : archiveStatus === 'ready'
                        ? 'Prepare new archive'
                        : 'Prepare archive'}
                </Button>
              </div>
            ) : null}
          </form>
        </Frame>
      </Section>
    </div>
  )
}
