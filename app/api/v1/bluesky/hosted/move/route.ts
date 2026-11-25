import { z } from 'zod'

import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { getHostedBlueskyAccountState } from '@/lib/services/pds/accounts'
import {
  cancelMoveOut,
  copyMoveOutBlobs,
  copyMoveOutPreferences,
  finishMoveOut,
  getMoveOutProgress,
  sendMoveOutRepo,
  startMoveOut
} from '@/lib/services/pds/moveOut'
import {
  MOVE_ERROR_STATUSES,
  checkCurrentPassword,
  hostedBlueskyRouteResponse
} from '@/lib/services/pds/routeResponse'
import type { HttpMethod } from '@/lib/utils/http-headers'
import { apiCorsError } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const dynamic = 'force-dynamic'

const METHODS: HttpMethod[] = ['GET', 'POST', 'DELETE']

const MoveStepBody = z.discriminatedUnion('step', [
  z.object({
    step: z.literal('start'),
    pdsUrl: z.string().min(1),
    handle: z.string().min(1),
    email: z.string().min(1),
    password: z.string().min(1),
    inviteCode: z.string().optional(),
    // The profile's password: starting a move sends a token signed with the
    // account's key and its data to a server the request names.
    currentPassword: z.string().optional()
  }),
  z.object({
    step: z.literal('repo')
  }),
  z.object({
    step: z.literal('blobs'),
    cursor: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(100).optional()
  }),
  z.object({
    step: z.literal('preferences')
  }),
  z.object({
    step: z.literal('finish'),
    // Checked by `checkCurrentPassword` so missing/wrong passwords answer 403.
    currentPassword: z.string().optional()
  })
])

const NO_PASSWORD_MOVE_MESSAGE =
  'Set a password before moving your Bluesky account. Use "Forgot password" to set one; the link is sent to your email address.'

export const GET = traceApiRoute(
  'getHostedBlueskyMoveOut',
  AuthenticatedGuard(async (req, { currentActor, database }) =>
    hostedBlueskyRouteResponse(
      req,
      METHODS,
      async () => {
        const progress = await getMoveOutProgress({
          database,
          actor: currentActor
        })
        const state = await getHostedBlueskyAccountState({
          database,
          actor: currentActor
        })
        return { progress, state }
      },
      { errorStatuses: MOVE_ERROR_STATUSES }
    )
  )
)

export const POST = traceApiRoute(
  'stepHostedBlueskyMoveOut',
  AuthenticatedGuard(async (req, { currentActor, database }) => {
    const parsed = MoveStepBody.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return apiCorsError(req, METHODS, 400)

    if (parsed.data.step === 'start' || parsed.data.step === 'finish') {
      const refused = await checkCurrentPassword(
        req,
        currentActor,
        parsed.data.currentPassword,
        METHODS,
        NO_PASSWORD_MOVE_MESSAGE
      )
      if (refused) return refused
    }

    const input = parsed.data
    return hostedBlueskyRouteResponse(
      req,
      METHODS,
      () => {
        switch (input.step) {
          case 'start':
            return startMoveOut({
              database,
              actor: currentActor,
              pdsUrl: input.pdsUrl,
              handle: input.handle,
              email: input.email,
              password: input.password,
              inviteCode: input.inviteCode
            })
          case 'repo':
            return sendMoveOutRepo({
              database,
              actor: currentActor
            })
          case 'blobs':
            return copyMoveOutBlobs({
              database,
              actor: currentActor,
              cursor: input.cursor,
              limit: input.limit
            })
          case 'preferences':
            return copyMoveOutPreferences({
              database,
              actor: currentActor
            })
          case 'finish':
            return finishMoveOut({
              database,
              actor: currentActor
            })
        }
      },
      { errorStatuses: MOVE_ERROR_STATUSES }
    )
  })
)

export const DELETE = traceApiRoute(
  'cancelHostedBlueskyMoveOut',
  AuthenticatedGuard(async (req, { currentActor, database }) =>
    hostedBlueskyRouteResponse(
      req,
      METHODS,
      () =>
        cancelMoveOut({
          database,
          actor: currentActor
        }),
      { errorStatuses: MOVE_ERROR_STATUSES }
    )
  )
)
