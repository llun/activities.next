import { revalidatePath } from 'next/cache'

import { DEFAULT_202, ERROR_404, ERROR_500 } from '../../../../../lib/errors'
import {
  AppRouterParams,
  AppRouterSharedKeyGuard,
  headerHost
} from '../../../../../lib/guard'
import { getStorage } from '../../../../../lib/storage'

type Query = AppRouterParams<{ username: string }>

export const GET = AppRouterSharedKeyGuard(async (req, query?: Query) => {
  const storage = await getStorage()
  if (!storage || !query) {
    return Response.json(ERROR_500, { status: 500 })
  }

  const { username } = query.params
  const host = headerHost(req.headers)
  const actor = await storage.getActorFromUsername({
    username: username as string,
    domain: host as string
  })
  if (!actor) {
    return Response.json(ERROR_404, { status: 404 })
  }

  revalidatePath(`/${actor.getMention()}`)
  revalidatePath(`/${actor.getMention(true)}`)
  return Response.json(DEFAULT_202, { status: 202 })
})
