import { NextRequest } from 'next/server'

import { ERROR_404, ERROR_500 } from '../../../../lib/errors'
import { Actor } from '../../../../lib/models/actor'
import { headerHost } from '../../../../lib/services/guards/headerHost'
import { AppRouterParams } from '../../../../lib/services/guards/types'
import { getStorage } from '../../../../lib/storage'
import { Storage } from '../../../../lib/storage/types'

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
      return Response.json(ERROR_500, { status: 500 })
    }

    const { username } = query.params
    const host = headerHost(req.headers)
    const id = `https://${host}/users/${username}`
    const actor = await storage.getActorFromId({ id })
    if (!actor || !actor.account) {
      return Response.json(ERROR_404, { status: 404 })
    }

    return handle(storage, actor, req, query)
  }
