import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/models/actor'
import { apiErrorResponse } from '@/lib/utils/response'

import { headerHost } from './headerHost'
import { AppRouterParams } from './types'

export type OnlyLocalUserGuardParams = {
  username: string
}

export type OnlyLocalUserGuardHandle = (
  database: Database,
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
    const database = getDatabase()
    if (!database) return apiErrorResponse(500)

    const { username } = await query.params
    const host = headerHost(req.headers)
    const id = `https://${host}/users/${username}`
    const actor = await database.getActorFromId({ id })
    if (!actor || !actor.account) {
      return apiErrorResponse(404)
    }

    return handle(database, actor, req, query)
  }
