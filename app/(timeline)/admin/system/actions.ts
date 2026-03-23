'use server'

import { redirect } from 'next/navigation'

import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { ENV_VAR_PREFIX } from '@/lib/utils/adminConstants'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

export async function revealEnvVar(key: string): Promise<string | null> {
  if (!key.startsWith(ENV_VAR_PREFIX)) return null

  const database = getDatabase()
  if (!database) return null

  const session = await getServerAuthSession()
  const admin = await getAdminFromSession(database, session)
  if (!admin) redirect('/')

  return process.env[key] ?? null
}
