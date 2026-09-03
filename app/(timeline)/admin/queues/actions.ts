'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getDatabase } from '@/lib/database'
import { Database } from '@/lib/database/types'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getQueue } from '@/lib/services/queue'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'
import { logger } from '@/lib/utils/logger'

const ADMIN_QUEUES_PATH = '/admin/queues'

const getAdminDatabase = async (): Promise<Database> => {
  const database = getDatabase()
  if (!database) throw new Error('Failed to load database')

  const session = await getServerAuthSession()
  const admin = await getAdminFromSession(database, session)
  if (!admin) redirect('/')

  return database
}

const extractId = (idOrFormData: string | FormData): string => {
  if (typeof idOrFormData === 'string') return idOrFormData.trim()
  return String(idOrFormData.get('id') ?? '').trim()
}

export async function retryDeadLetterJob(idOrFormData: string | FormData) {
  const database = await getAdminDatabase()
  const id = extractId(idOrFormData)
  if (!id) return { success: false, error: 'Missing job ID' }

  const job = await database.getDeadLetterJobById(id)
  if (!job) {
    logger.warn({ id }, 'Cannot retry dead letter job: not found')
    return { success: false, error: 'Job not found' }
  }

  try {
    await getQueue().publish(job.payload)
    await database.updateDeadLetterJobStatus(id, 'retried')
    revalidatePath(ADMIN_QUEUES_PATH)
    return { success: true }
  } catch (error) {
    logger.error({
      err: error,
      id,
      message: 'Failed to re-dispatch dead letter job'
    })
    return { success: false, error: 'Failed to publish job' }
  }
}

export async function discardDeadLetterJob(idOrFormData: string | FormData) {
  const database = await getAdminDatabase()
  const id = extractId(idOrFormData)
  if (!id) return { success: false, error: 'Missing job ID' }

  await database.updateDeadLetterJobStatus(id, 'discarded')
  revalidatePath(ADMIN_QUEUES_PATH)
  return { success: true }
}

export async function retryAllDeadLetterJobs() {
  const database = await getAdminDatabase()
  const failedJobs = await database.getDeadLetterJobs({
    status: 'failed',
    limit: 1000
  })

  const queue = getQueue()
  let retriedCount = 0
  for (const job of failedJobs) {
    try {
      await queue.publish(job.payload)
      await database.updateDeadLetterJobStatus(job.id, 'retried')
      retriedCount++
    } catch (error) {
      logger.error({
        err: error,
        jobId: job.id,
        message: 'Failed to retry dead letter job in batch'
      })
    }
  }

  revalidatePath(ADMIN_QUEUES_PATH)
  return { success: true, count: retriedCount }
}

export async function clearDiscardedJobs() {
  const database = await getAdminDatabase()
  const count = await database.deleteDeadLetterJobsByStatus('discarded')
  revalidatePath(ADMIN_QUEUES_PATH)
  return { success: true, count }
}
