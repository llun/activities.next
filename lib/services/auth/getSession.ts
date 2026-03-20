import { headers } from 'next/headers'

import { getAuth } from './auth'

export const getServerAuthSession = async () => {
  const auth = getAuth()
  const session = await auth.api.getSession({
    headers: await headers()
  })
  return session
}
