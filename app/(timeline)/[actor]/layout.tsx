import { headers } from 'next/headers'
import { permanentRedirect } from 'next/navigation'
import { FC, ReactNode } from 'react'

import { PublicShell } from '@/app/(timeline)/PublicShell'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { parseAccountHandle } from '@/lib/utils/accountHandle'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import {
  LOCAL_HANDLE_REDIRECT_PATH_HEADER,
  LOCAL_HANDLE_REDIRECT_SEARCH_HEADER
} from '@/lib/utils/http-headers/localHandleRedirect'

import { getLocalHandleRedirect } from './getLocalHandleRedirect'

interface LayoutProps {
  children: ReactNode
  params: Promise<{ actor: string }>
}

/**
 * Profiles, single statuses, followers/following and profile fitness under
 * `[actor]` are viewable while logged out. Signed-in visitors already get the
 * nav sidebar from the `(timeline)` layout, so this only adds the public top
 * bar + footer chrome for logged-out visitors; signed-in renders pass through
 * untouched.
 */
const Layout: FC<LayoutProps> = async ({ children, params }) => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Failed to load database')
  }

  const { actor: requestedHandle } = await params
  const handle: ReturnType<typeof parseAccountHandle> = (() => {
    try {
      return parseAccountHandle(decodeURIComponent(requestedHandle))
    } catch {
      return null
    }
  })()
  const actorForHandle = handle
    ? await database.getActorFromUsername(handle)
    : null
  const requestHeaders = await headers()
  const redirectTarget = getLocalHandleRedirect({
    actor: actorForHandle,
    requestedHandle,
    pathname: requestHeaders.get(LOCAL_HANDLE_REDIRECT_PATH_HEADER),
    search: requestHeaders.get(LOCAL_HANDLE_REDIRECT_SEARCH_HEADER)
  })
  if (redirectTarget) permanentRedirect(redirectTarget)

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  if (actor) return <>{children}</>

  return <PublicShell>{children}</PublicShell>
}

export default Layout
