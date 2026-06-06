import { Database } from '@/lib/database/types'
import {
  AuthSession,
  getAccountFromSession
} from '@/lib/utils/getActorFromSession'

export const getAdminFromSession = async (
  database: Database,
  session: AuthSession | null
) => {
  const account = await getAccountFromSession(database, session)
  if (!account || account.role !== 'admin') return null

  return account
}
