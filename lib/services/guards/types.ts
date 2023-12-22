import { Session } from 'next-auth'
import { NextRequest } from 'next/server'

import { Actor } from '../../models/actor'
import { Storage } from '../../storage/types'

export type BaseContext = {
  storage: Storage
  session: Session
}

export type AppRouterParams<P> = { params: P }
export type AppRouterApiHandle<P> = (
  request: NextRequest,
  params?: AppRouterParams<P>
) => Promise<Response> | Response

export type AuthenticatedApiHandle<P> = (
  request: NextRequest,
  context: BaseContext & { currentActor: Actor },
  params?: AppRouterParams<P>
) => Promise<Response> | Response
