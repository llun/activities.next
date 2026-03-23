import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { AuthSession } from '@/lib/utils/getActorFromSession'

export const getAdminFromSession = async (
  database: Database,
  session: AuthSession | null
) => {
  if (!session?.user?.email) return null

  const config = getConfig()
  if (
    config.allowEmails.length &&
    !config.allowEmails.includes(session.user.email)
  ) {
    return null
  }

  const account = await database.getAccountFromEmail({
    email: session.user.email
  })
  if (!account || account.role !== 'admin') return null

  return account
}
