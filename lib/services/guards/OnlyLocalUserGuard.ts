import { NextRequest } from 'next/server'

import { ERROR_404, ERROR_500, defaultStatusOption } from '@/lib/errors'
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
      if (!storage) {
        return Response.json(ERROR_500, defaultStatusOption(500))
      }

      const { username } = query.params
      const host = headerHost(req.headers)
      const id = `https://${host}/users/${username}`
      const actor = await storage.getActorFromId({ id })
      if (!actor || !actor.account) {
        return Response.json(ERROR_404, defaultStatusOption(404))
      }

      return handle(storage, actor, req, query)
    }
