import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/models/actor'

export type AppRouterParams<P> = { params: Promise<P> }
export type AppRouterApiHandle<P> = (
  request: NextRequest,
  params: AppRouterParams<P>
) => Promise<Response> | Response

export type AuthenticatedApiHandle<P> = (
  request: NextRequest,
  context: { database: Database; currentActor: Actor },
  params: AppRouterParams<P>
) => Promise<Response> | Response

export type ActivityPubVerifiedSenderHandle<P> = (
  request: NextRequest,
  context: { database: Database },
  params: AppRouterParams<P>
) => Promise<Response> | Response
