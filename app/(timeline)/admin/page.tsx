import { redirect } from 'next/navigation'

import { StatsOverview } from '@/lib/components/admin/StatsOverview'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import {
  ALL_COUNTER_TYPES,
  ServiceStatCounterType
} from '@/lib/types/database/operations'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

export const dynamic = 'force-dynamic'

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
    ...ALL_COUNTER_TYPES.map((counterType) =>
      database.getServiceStatsBuckets({ counterType, startTime, endTime })
    )
  ])

  const initialBuckets = Object.fromEntries(
    ALL_COUNTER_TYPES.map((counterType, i) => [counterType, bucketResults[i]])
  ) as Record<ServiceStatCounterType, (typeof bucketResults)[0]>

  return <StatsOverview stats={stats} initialBuckets={initialBuckets} />
}

export default Page
