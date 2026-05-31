import { Flame } from 'lucide-react'
import { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FC } from 'react'

import { PageHeader } from '@/lib/components/page-header'
import { Button } from '@/lib/components/ui/button'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { Status } from '@/lib/types/domain/status'
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
  if (!hasFitnessData) {
    return notFound()
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
        statuses={statuses}
      />
    </div>
  )
}

export default Page
