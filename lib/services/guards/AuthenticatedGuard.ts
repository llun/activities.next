import { getServerSession } from 'next-auth'
import { NextRequest } from 'next/server'

import { authOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { getStorage } from '@/lib/storage'

import { AppRouterParams, AuthenticatedApiHandle } from './types'

export const AuthenticatedGuard =
  <P>(handle: AuthenticatedApiHandle<P>) =>
  async (req: NextRequest, params?: AppRouterParams<P>) => {
    const [storage, session] = await Promise.all([
      getStorage(),
      getServerSession(authOptions)
    ])
    if (!storage || !session?.user?.email) {
      return Response.redirect('/signin', 307)
    }

    const currentActor = await storage.getActorFromEmail({
      email: session.user.email
    })
    if (!currentActor) {
      return Response.redirect('/signin', 307)
    }

    return handle(req, { currentActor, storage, session }, params)
  }
