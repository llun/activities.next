import { NextRequest } from 'next/server'

import { ERROR_404, ERROR_500 } from '../../../../lib/errors'
import { AppRouterParams, headerHost } from '../../../../lib/guard'
import { Actor } from '../../../../lib/models/actor'
import { getStorage } from '../../../../lib/storage'
import { Storage } from '../../../../lib/storage/types'

type OnlyLocalUserGuardParams = {
  username: string
}

export type OnlyLocalUserGuardHandle = (
  storage: Storage,
  actor: Actor,
  request: NextRequest,
  params: AppRouterParams<OnlyLocalUserGuardParams>
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
    console.log(id)
    const actor = await storage.getActorFromId({ id })
    if (!actor || !actor.account) {
      return Response.json(ERROR_404, { status: 404 })
    }

    return handle(storage, actor, req, query)
  }
