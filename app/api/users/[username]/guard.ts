import { NextRequest } from 'next/server'

import { ERROR_404, ERROR_500 } from '../../../../lib/errors'
import {
  AppRouterApiHandle,
  AppRouterParams,
  headerHost
} from '../../../../lib/guard'
import { getStorage } from '../../../../lib/storage'

type OnlyLocalUserGuardParams = {
  username: string
}

export const OnlyLocalUserGuard =
  (handle: AppRouterApiHandle<OnlyLocalUserGuardParams>) =>
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

    return handle(req, query)
  }
