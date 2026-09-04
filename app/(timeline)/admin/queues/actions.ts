'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getDLQProvider } from '@/lib/services/queue/dlq'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

const ADMIN_QUEUES_PATH = '/admin/queues'

const verifyAdmin = async (): Promise<void> => {
  const database = getDatabase()
  if (!database) throw new Error('Failed to load database')

  const session = await getServerAuthSession()
  const admin = await getAdminFromSession(database, session)
  if (!admin) redirect('/')
}

const extractId = (idOrFormData: string | FormData): string => {
  if (typeof idOrFormData === 'string') return idOrFormData.trim()
  return String(idOrFormData.get('id') ?? '').trim()
}

export async function retryDeadLetterJob(idOrFormData: string | FormData) {
  await verifyAdmin()
  const id = extractId(idOrFormData)
  if (!id) return { success: false, error: 'Missing job ID' }

  const provider = getDLQProvider()
  const result = await provider.retryJob(id)
  revalidatePath(ADMIN_QUEUES_PATH)
  return result
}

export async function discardDeadLetterJob(idOrFormData: string | FormData) {
  await verifyAdmin()
  const id = extractId(idOrFormData)
  if (!id) return { success: false, error: 'Missing job ID' }

  const provider = getDLQProvider()
  const result = await provider.discardJob(id)
  revalidatePath(ADMIN_QUEUES_PATH)
  return result
}

export async function retryAllDeadLetterJobs() {
  await verifyAdmin()
  const provider = getDLQProvider()
  const result = await provider.retryAll()
  revalidatePath(ADMIN_QUEUES_PATH)
  return result
}

export async function clearDiscardedJobs() {
  await verifyAdmin()
  const provider = getDLQProvider()
  const result = await provider.clearDiscarded()
  revalidatePath(ADMIN_QUEUES_PATH)
  return result
}
