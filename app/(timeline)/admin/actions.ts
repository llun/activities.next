'use server'

import { redirect } from 'next/navigation'

import { getDatabase } from '@/lib/database'
import { resolveSessionAdmin } from '@/lib/services/guards/sessionActor'
import {
  ALL_COUNTER_TYPES,
  MAX_STATS_WINDOW_MS,
  ServiceStatCounterType,
  ServiceStatsBucket
} from '@/lib/types/database/operations'

function validateTimeRange(
  startTime: number,
  endTime: number
): { start: number; end: number } {
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    throw new Error('startTime and endTime must be finite numbers')
  }
  if (startTime < 0 || endTime < 0) {
    throw new Error('startTime and endTime must be positive')
  }
  if (startTime > endTime) {
    throw new Error('startTime must be <= endTime')
  }
  const clampedStart = Math.max(startTime, endTime - MAX_STATS_WINDOW_MS)
  return { start: clampedStart, end: endTime }
}

export async function getStatsBuckets(
  counterType: string,
  startTime: number,
  endTime: number
): Promise<ServiceStatsBucket[]> {
  const database = getDatabase()
  if (!database) throw new Error('Failed to load database')

  const admin = await resolveSessionAdmin(database)
  if (!admin) return redirect('/')

  if (!ALL_COUNTER_TYPES.includes(counterType as ServiceStatCounterType)) {
    throw new Error(`Invalid counterType: ${counterType}`)
  }

  const { start, end } = validateTimeRange(startTime, endTime)

  return database.getServiceStatsBuckets({
    counterType: counterType as ServiceStatCounterType,
    startTime: start,
    endTime: end
  })
}

export async function getAllStatsBuckets(
  startTime: number,
  endTime: number
): Promise<Record<ServiceStatCounterType, ServiceStatsBucket[]>> {
  const database = getDatabase()
  if (!database) throw new Error('Failed to load database')

  const admin = await resolveSessionAdmin(database)
  if (!admin) return redirect('/')

  const { start, end } = validateTimeRange(startTime, endTime)

  const results = await Promise.all(
    ALL_COUNTER_TYPES.map((counterType) =>
      database.getServiceStatsBuckets({
        counterType,
        startTime: start,
        endTime: end
      })
    )
  )

  return Object.fromEntries(
    ALL_COUNTER_TYPES.map((counterType, i) => [counterType, results[i]])
  ) as Record<ServiceStatCounterType, ServiceStatsBucket[]>
}
