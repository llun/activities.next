import { redirect } from 'next/navigation'

import { StatsOverview } from '@/lib/components/admin/StatsOverview'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { ServiceStatCounterType } from '@/lib/types/database/operations'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

export const dynamic = 'force-dynamic'

const COUNTER_TYPES: ServiceStatCounterType[] = [
  'accounts',
  'actors',
  'statuses',
  'media-files',
  'media-bytes',
  'fitness-files',
  'fitness-bytes'
]

const Page = async () => {
  const database = getDatabase()
  if (!database) throw new Error('Failed to load database')

  const session = await getServerAuthSession()
  const admin = await getAdminFromSession(database, session)
  if (!admin) return redirect('/')

  const endTime = Date.now()
  const startTime = endTime - 7 * 24 * 60 * 60 * 1000

  const [stats, ...bucketResults] = await Promise.all([
    database.getServiceStats(),
    ...COUNTER_TYPES.map((counterType) =>
      database.getServiceStatsBuckets({ counterType, startTime, endTime })
    )
  ])

  const initialBuckets = Object.fromEntries(
    COUNTER_TYPES.map((counterType, i) => [counterType, bucketResults[i]])
  ) as Record<ServiceStatCounterType, (typeof bucketResults)[0]>

  return <StatsOverview stats={stats} initialBuckets={initialBuckets} />
}

export default Page
