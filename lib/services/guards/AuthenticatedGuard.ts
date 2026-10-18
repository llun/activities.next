import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { apiErrorResponse } from '@/lib/utils/response'

import {
  isActorConfirmationPending,
  isActorModerationBlocked
} from './accountState'
import { annotateAuthSuccess } from './authTrace'
import { getRedirectUrl } from './getRedirectUrl'
import { hasSameOriginProof } from './sameOriginProof'
import { AppRouterParams, AuthenticatedApiHandle } from './types'

export type AuthenticatedGuardOptions = {
  allowUnconfirmedAccount?: boolean
  allowModerationBlocked?: boolean
}

// A native form submit is a top-level navigation. Answering it with 307 makes
// the browser repeat the POST against /auth/signin, a page that refuses POST
// (404), so use 303 to turn the follow-up into a GET. fetch()/XHR callers (and
// browsers that send no Sec-Fetch headers) keep 307 so a mutation is never
// reported as a successful response.
const signinRedirectStatus = (req: NextRequest) =>
  req.headers.get('sec-fetch-mode') === 'navigate' ? 303 : 307

export const AuthenticatedGuard =
  <P>(
    handle: AuthenticatedApiHandle<P>,
    options: AuthenticatedGuardOptions = {}
  ) =>
  async (req: NextRequest, context: AppRouterParams<P>) => {
    // Reject forged cross-site mutations before paying for session
    // resolution — the check only reads the method and two headers.
    if (!hasSameOriginProof(req)) {
      return apiErrorResponse(403)
    }

    const database = getDatabase()
    const session = await getServerAuthSession()

    if (!database || !session?.user?.email) {
      return Response.redirect(
        getRedirectUrl(req, '/auth/signin'),
        signinRedirectStatus(req)
      )
    }

    const currentActor = await getActorFromSession(database, session)
    if (!currentActor) {
      return Response.redirect(
        getRedirectUrl(req, '/auth/signin'),
        signinRedirectStatus(req)
      )
    }

    if (
      !options.allowModerationBlocked &&
      isActorModerationBlocked(currentActor)
    ) {
      return apiErrorResponse(403)
    }

    if (
      !options.allowUnconfirmedAccount &&
      isActorConfirmationPending(currentActor)
    ) {
      return apiErrorResponse(403)
    }

    annotateAuthSuccess({
      authType: 'session',
      actorId: currentActor.id,
      userId:
        currentActor.account?.id ??
        (session.user as { id?: string })?.id ??
        null
    })

    return handle(req, { currentActor, database, params: context.params })
  }
