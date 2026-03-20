import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { getRedirectUrl } from './getRedirectUrl'
import { AppRouterParams, AuthenticatedApiHandle } from './types'

export const AuthenticatedGuard =
  <P>(handle: AuthenticatedApiHandle<P>) =>
  async (req: NextRequest, context: AppRouterParams<P>) => {
    const database = getDatabase()
    const session = await getServerAuthSession()

    if (!database || !session?.user?.email) {
      return Response.redirect(getRedirectUrl(req, '/auth/signin'), 307)
    }

    const currentActor = await getActorFromSession(database, session)
    if (!currentActor) {
      return Response.redirect(getRedirectUrl(req, '/auth/signin'), 307)
    }

    return handle(req, { currentActor, database, params: context.params })
  }
