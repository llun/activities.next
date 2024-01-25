import { Session } from 'next-auth'

import { getConfig } from '@/lib/config'
import { Storage } from '@/lib/storage/types'

export const getActorFromSession = async (
  storage: Storage,
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

  return storage.getActorFromEmail({ email: session.user.email })
}
