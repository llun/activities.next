import { z } from 'zod'

import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import {
  changeHostedBlueskyHandle,
  createHostedBlueskyAccount,
  deactivateHostedBlueskyAccount,
  deleteHostedBlueskyAccount,
  getHostedBlueskyAccountState,
  reactivateHostedBlueskyAccount,
  setHostedBlueskyRecoveryKey
} from '@/lib/services/pds/accounts'
import { hostedBlueskyRouteResponse } from '@/lib/services/pds/routeResponse'
import type { HttpMethod } from '@/lib/utils/http-headers'
import { apiCorsError } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const dynamic = 'force-dynamic'

const METHODS: HttpMethod[] = ['GET', 'POST', 'PATCH', 'DELETE']

const CreateBody = z.object({ handle: z.string().min(1) })

const UpdateBody = z.object({
  handle: z.string().min(1).optional(),
  // null removes the recovery key; absent leaves it alone.
  recoveryKeyDid: z.string().min(1).nullable().optional(),
  active: z.boolean().optional()
})

const DeleteBody = z.object({ confirmHandle: z.string().min(1) })

export const GET = traceApiRoute(
  'getHostedBlueskyAccount',
  AuthenticatedGuard(async (req, { currentActor, database }) =>
    hostedBlueskyRouteResponse(req, METHODS, () =>
      getHostedBlueskyAccountState({ database, actor: currentActor })
    )
  )
)

export const POST = traceApiRoute(
  'createHostedBlueskyAccount',
  AuthenticatedGuard(async (req, { currentActor, database }) => {
    const parsed = CreateBody.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return apiCorsError(req, METHODS, 400)
    return hostedBlueskyRouteResponse(req, METHODS, () =>
      createHostedBlueskyAccount({
        database,
        actor: currentActor,
        handle: parsed.data.handle
      })
    )
  })
)

export const PATCH = traceApiRoute(
  'updateHostedBlueskyAccount',
  AuthenticatedGuard(async (req, { currentActor, database }) => {
    const parsed = UpdateBody.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return apiCorsError(req, METHODS, 400)
    return hostedBlueskyRouteResponse(req, METHODS, async () => {
      if (parsed.data.active !== undefined) {
        if (parsed.data.active) {
          await reactivateHostedBlueskyAccount({
            database,
            actor: currentActor
          })
        } else {
          await deactivateHostedBlueskyAccount({
            database,
            actor: currentActor
          })
        }
      }
      if (parsed.data.handle !== undefined) {
        await changeHostedBlueskyHandle({
          database,
          actor: currentActor,
          handle: parsed.data.handle
        })
      }
      if (parsed.data.recoveryKeyDid !== undefined) {
        await setHostedBlueskyRecoveryKey({
          database,
          actor: currentActor,
          recoveryKeyDid: parsed.data.recoveryKeyDid
        })
      }
      return getHostedBlueskyAccountState({
        database,
        actor: currentActor
      })
    })
  })
)

export const DELETE = traceApiRoute(
  'deleteHostedBlueskyAccount',
  AuthenticatedGuard(async (req, { currentActor, database }) => {
    const parsed = DeleteBody.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return apiCorsError(req, METHODS, 400)
    return hostedBlueskyRouteResponse(req, METHODS, () =>
      deleteHostedBlueskyAccount({
        database,
        actor: currentActor,
        confirmHandle: parsed.data.confirmHandle
      })
    )
  })
)
