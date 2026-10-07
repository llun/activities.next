import { Activity } from 'lucide-react'
import { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FC } from 'react'

import { FitnessEmptyState } from '@/lib/components/fitness/FitnessEmptyState'
import { PageHeader } from '@/lib/components/page-header'
import { Button } from '@/lib/components/ui/button'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorProfile } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'
import { cleanJson } from '@/lib/utils/cleanJson'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { ActorFitnessDashboard } from './ActorFitnessDashboard'
import { OverviewHeaderSlot } from './FitnessOverviewHeader'
import { RecentFitnessActivities } from './RecentFitnessActivities'
import {
  readActivityTypeParam,
  resolveActivityTypeFilter
} from './activityFilter'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Fitness'
}

const RECENT_LIMIT = 5

// The range is the viewer's to choose (year to date by default), so the empty
// state's description names what the page holds, not a fixed span.
const OVERVIEW_DESCRIPTION = 'Your totals and training calendar'

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const Page: FC<Props> = async ({ searchParams }) => {
  const database = getDatabase()
  if (!database) throw new Error('Database is not available')

  // A missing/expired session on this first-class signed-in section should take
  // the login path (like Files/Privacy), not look like a missing route.
  const session = await getServerAuthSession()
  const currentActor = await getActorFromSession(database, session)
  if (!currentActor || !currentActor.account) {
    return redirect('/auth/signin')
  }

  const hasFitnessData = await database.getActorHasFitnessData({
    actorId: currentActor.id
  })

  // No activity yet: show a discoverable empty state (instead of a 404) so a
  // new user can reach the import / Strava setup pages from the section itself.
  if (!hasFitnessData) {
    return (
      <div className="space-y-6">
        <PageHeader title="Overview" description={OVERVIEW_DESCRIPTION} />
        <FitnessEmptyState
          icon={Activity}
          title="No activity yet"
          titleAs="h2"
          action={
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link href="/fitness/files">Import activities</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/fitness/strava">Connect Strava</Link>
              </Button>
            </div>
          }
        >
          Import a FIT, GPX, or TCX file — or connect Strava — to start tracking
          your fitness here.
        </FitnessEmptyState>
      </div>
    )
  }

  // Actor-scoped (matching the dashboard + the hasFitnessData gate above) so a
  // multi-actor account shows the signed-in actor's own recent activities.
  // A `?activity=` value is honoured only when it names one of this actor's own
  // stored activity types — see `resolveActivityTypeFilter` for why an unchecked
  // one is not merely useless but unsafe. The extra read is paid for only by a
  // request that asked for a filter; the unfiltered page runs the same two
  // queries it always did.
  const requestedActivityType = readActivityTypeParam(await searchParams)
  const readRecentStatuses = async () => {
    const activityType = requestedActivityType
      ? resolveActivityTypeFilter(
          requestedActivityType,
          await database.getDistinctActivityTypesForActor({
            actorId: currentActor.id
          })
        )
      : undefined
    const recentFiles = await database.getFitnessFilesByActor({
      actorId: currentActor.id,
      limit: RECENT_LIMIT,
      processingStatus: 'completed',
      isPrimary: true,
      // Spread rather than a plain key so "no filter" passes no `activityType` at
      // all. The database method happens to read an explicit `undefined` the same
      // way, but `null` means something else entirely there — "activities with no
      // recorded type" — so the narrowing stays something this call states only
      // when it means it.
      ...(activityType ? { activityType } : {})
    })
    const statusIds = Array.from(
      new Set(
        recentFiles
          .map((file) => file.statusId)
          .filter((id): id is string => Boolean(id))
      )
    )
    const loadedStatuses = await Promise.all(
      statusIds.map((statusId) =>
        database
          // This page is signed-in only, and these statuses render the same
          // interactive chips as everywhere else — without the viewer their
          // reaction (and like/bookmark) state reads false.
          .getStatus({ statusId, currentActorId: currentActor.id })
          .catch(() => null)
      )
    )
    const statuses = loadedStatuses.filter(
      (status): status is Status => status !== null
    )
    return { activityType, statuses }
  }

  // The year chooser's bounds do not depend on the recent activities, so the
  // two are read together rather than one round trip after the other.
  const [{ activityType, statuses }, { earliest: earliestActivityTime }] =
    await Promise.all([
      readRecentStatuses(),
      // Bounds the year chooser: the earliest year with a countable activity.
      // An epoch-millisecond number, not a Date, because it crosses into a
      // Client Component.
      database.getFitnessActivityTimeBounds({ actorId: currentActor.id })
    ])

  const currentTime = Date.now()
  const host = getConfig().host

  return (
    <div className="space-y-6">
      {/* On wide containers the dashboard fills these slots with the applied
          dates and the range picker, as the desktop and tablet designs lay
          out the heading. They are empty here: the dates are the viewer's
          local days, which only the client knows. On a compact container the
          dashboard keeps its own heading and leaves them empty for good.
          PageHeader cannot tell an empty slot from a filled one, so its
          description and actions wrappers still render: about 4px under
          "Overview" and one unused gap in the row. Accepted; hiding them
          would need the client's width on the server. */}
      <PageHeader
        title="Overview"
        description={<OverviewHeaderSlot slot="dates" />}
        actions={<OverviewHeaderSlot slot="range" />}
      />

      <ActorFitnessDashboard
        actorId={currentActor.id}
        currentTime={currentTime}
        selectedActivityType={activityType}
        earliestActivityTime={earliestActivityTime}
      />

      {/* `getActorProfile`, never the raw `Actor` and never `cleanJson`, which
          is a JSON round-trip that clones without narrowing. This prop crosses
          into a Client Component, and React serialises whatever it is handed
          into the flight payload embedded in the HTML — `Actor` carries
          `privateKey`, `publicKey` and the whole `account` row (email,
          passwordHash, reset codes), which is exactly why those fields are kept
          off `ActorProfile`. Every other page in this group strips the same way. */}
      <RecentFitnessActivities
        host={host}
        currentTime={currentTime}
        currentActor={getActorProfile(currentActor)}
        statuses={statuses.map((status) => cleanJson(status))}
        activityType={activityType}
      />
    </div>
  )
}

export default Page
