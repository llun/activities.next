import { Session } from 'next-auth'

import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'

export const getActorFromSession = async (
  database: Database,
  session: Session | null
) => {
  const config = getConfig()
  if (!session?.user?.email) return null
  if (
    config.allowEmails.length &&
    !config.allowEmails.includes(session.user.email)
  ) {
    return null
  }

  return database.getActorFromEmail({ email: session.user.email })
}
