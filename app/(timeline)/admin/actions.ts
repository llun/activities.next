'use server'

import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import {
  ServiceStatCounterType,
  ServiceStatsBucket
} from '@/lib/types/database/operations'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

const VALID_COUNTER_TYPES: ServiceStatCounterType[] = [
  'accounts',
  'actors',
  'statuses',
  'media-files',
  'media-bytes',
  'fitness-files',
  'fitness-bytes'
]

export async function getStatsBuckets(
  counterType: string,
  startTime: number,
  endTime: number
): Promise<ServiceStatsBucket[]> {
  const database = getDatabase()
  if (!database) throw new Error('Failed to load database')

  const session = await getServerAuthSession()
  const admin = await getAdminFromSession(database, session)
  if (!admin) throw new Error('Unauthorized')

  if (!VALID_COUNTER_TYPES.includes(counterType as ServiceStatCounterType)) {
    throw new Error(`Invalid counterType: ${counterType}`)
  }

  return database.getServiceStatsBuckets({
    counterType: counterType as ServiceStatCounterType,
    startTime,
    endTime
  })
}

export async function getAllStatsBuckets(
  startTime: number,
  endTime: number
): Promise<Record<ServiceStatCounterType, ServiceStatsBucket[]>> {
  const database = getDatabase()
  if (!database) throw new Error('Failed to load database')

  const session = await getServerAuthSession()
  const admin = await getAdminFromSession(database, session)
  if (!admin) throw new Error('Unauthorized')

  const results = await Promise.all(
    VALID_COUNTER_TYPES.map((counterType) =>
      database.getServiceStatsBuckets({ counterType, startTime, endTime })
    )
  )

  return Object.fromEntries(
    VALID_COUNTER_TYPES.map((counterType, i) => [counterType, results[i]])
  ) as Record<ServiceStatCounterType, ServiceStatsBucket[]>
}
