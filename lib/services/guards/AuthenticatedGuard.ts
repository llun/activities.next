import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { apiErrorResponse } from '@/lib/utils/response'

import { getRedirectUrl } from './getRedirectUrl'
import { hasSameOriginProof } from './sameOriginProof'
import { AppRouterParams, AuthenticatedApiHandle } from './types'

export const AuthenticatedGuard =
  <P>(handle: AuthenticatedApiHandle<P>) =>
  async (req: NextRequest, context: AppRouterParams<P>) => {
    // Reject forged cross-site mutations before paying for session
    // resolution — the check only reads the method and two headers.
    if (!hasSameOriginProof(req)) {
      return apiErrorResponse(403)
    }

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
