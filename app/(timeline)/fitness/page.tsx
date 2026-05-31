import { Flame } from 'lucide-react'
import { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FC } from 'react'

import { PageHeader } from '@/lib/components/page-header'
import { Button } from '@/lib/components/ui/button'
import { Card } from '@/lib/components/ui/card'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { Status } from '@/lib/types/domain/status'
import { cleanJson } from '@/lib/utils/cleanJson'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { ActorFitnessDashboard } from './ActorFitnessDashboard'
import { RecentFitnessActivities } from './RecentFitnessActivities'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Fitness'
}

const RECENT_LIMIT = 5

const Page: FC = async () => {
  const database = getDatabase()
  if (!database) throw new Error('Database is not available')

  const session = await getServerAuthSession()
  if (!session?.user?.email) {
    return notFound()
  }

  const currentActor = await getActorFromSession(database, session)
  if (!currentActor || !currentActor.account) {
    return notFound()
  }

  const hasFitnessData = await database.getActorHasFitnessData({
    actorId: currentActor.id
  })

  // No activity yet: show a discoverable empty state (instead of a 404) so a
  // new user can reach the import / Strava setup pages from the section itself.
  if (!hasFitnessData) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Overview"
          description="Your last 6 months of activity"
        />
        <Card className="flex flex-col items-start gap-4 p-6">
          <div className="space-y-1">
            <h2 className="text-base font-medium">No activity yet</h2>
            <p className="text-sm text-muted-foreground">
              Import a FIT, GPX, or TCX file — or connect Strava — to start
              tracking your fitness here.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/fitness/files">Import activities</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/fitness/strava">Connect Strava</Link>
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  const recentFiles = await database.getFitnessFilesWithStatusForAccount({
    accountId: currentActor.account.id,
    limit: RECENT_LIMIT
  })
  const statusIds = Array.from(
    new Set(
      recentFiles.items
        .map((file) => file.statusId)
        .filter((id): id is string => Boolean(id))
    )
  )
  const loadedStatuses = await Promise.all(
    statusIds.map((statusId) => database.getStatus({ statusId }))
  )
  const statuses = loadedStatuses.filter(
    (status): status is Status => status !== null
  )

  const currentTime = Date.now()
  const host = getConfig().host

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description="Your last 6 months of activity"
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/fitness/heatmap">
              <Flame className="mr-1.5 h-4 w-4" />
              Heatmap
            </Link>
          </Button>
        }
      />

      <ActorFitnessDashboard actorId={currentActor.id} />

      <RecentFitnessActivities
        host={host}
        currentTime={currentTime}
        statuses={statuses.map((status) => cleanJson(status))}
      />
    </div>
  )
}

export default Page
