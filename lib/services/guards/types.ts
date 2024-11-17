import { NextRequest } from 'next/server'

import { Actor } from '@/lib/models/actor'
import { Storage } from '@/lib/storage/types'

export type AppRouterParams<P> = { params: Promise<P> }
export type AppRouterApiHandle<P> = (
  request: NextRequest,
  params: AppRouterParams<P>
) => Promise<Response> | Response

export type AuthenticatedApiHandle<P> = (
  request: NextRequest,
  context: { storage: Storage; currentActor: Actor },
  params: AppRouterParams<P>
) => Promise<Response> | Response

export type ActivityPubVerifiedSenderHandle<P> = (
  request: NextRequest,
  context: { storage: Storage },
  params: AppRouterParams<P>
) => Promise<Response> | Response
