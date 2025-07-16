import { NextRequest } from 'next/server'

import { auth } from '@/auth'
import { getDatabase } from '@/lib/database'

import { getRedirectUrl } from './getRedirectUrl'
import { AppRouterParams, AuthenticatedApiHandle } from './types'

export const AuthenticatedGuard =
  <P>(handle: AuthenticatedApiHandle<P>) =>
  async (req: NextRequest, params: AppRouterParams<P>) => {
    const database = getDatabase()
    const session = await auth()

    if (!database || !session?.user?.email) {
      return Response.redirect(getRedirectUrl(req, '/signin'), 307)
    }

    const currentActor = await database.getActorFromEmail({
      email: session.user.email
    })
    if (!currentActor) {
      return Response.redirect(getRedirectUrl(req, '/signin'), 307)
    }

    return handle(req, { currentActor, database }, params)
  }
