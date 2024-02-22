import { NextRequest } from 'next/server'

import { apiErrorResponse } from '@/lib/errors'
import { Actor } from '@/lib/models/actor'
import { getStorage } from '@/lib/storage'
import { Storage } from '@/lib/storage/types'

import { headerHost } from './headerHost'
import { AppRouterParams } from './types'

export type OnlyLocalUserGuardParams = {
  username: string
}

export type OnlyLocalUserGuardHandle = (
  storage: Storage,
  actor: Actor,
  request: NextRequest,
  query: AppRouterParams<OnlyLocalUserGuardParams>
) => Promise<Response> | Response

export const OnlyLocalUserGuard =
  (handle: OnlyLocalUserGuardHandle) =>
  async (
    req: NextRequest,
    query: AppRouterParams<OnlyLocalUserGuardParams>
  ) => {
    const storage = await getStorage()
    if (!storage) return apiErrorResponse(500)

    const { username } = query.params
    const host = headerHost(req.headers)
    const id = `https://${host}/users/${username}`
    const actor = await storage.getActorFromId({ id })
    if (!actor || !actor.account) {
      return apiErrorResponse(404)
    }

    return handle(storage, actor, req, query)
  }
