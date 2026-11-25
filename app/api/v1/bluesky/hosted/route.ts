import type { NextRequest } from 'next/server'
import { z } from 'zod'

import type { Database } from '@/lib/database/types'
import { comparePassword } from '@/lib/services/auth/passwordHash'
import { checkPasswordChangeRateLimit } from '@/lib/services/auth/routeRateLimits'
import { getServedLinkDomain } from '@/lib/services/domains/localDomains'
import { sendMail } from '@/lib/services/email'
import { resolveEmailIdentity } from '@/lib/services/email/sender'
import { buildBlueskyRecoveryKeyNoticeEmail } from '@/lib/services/email/templates/blueskyRecoveryKeyNotice'
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
import type { Actor } from '@/lib/types/domain/actor'
import type { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import {
  apiCorsError,
  apiRateLimitedResponse,
  apiResponse
} from '@/lib/utils/response'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const dynamic = 'force-dynamic'

const METHODS: HttpMethod[] = ['GET', 'POST', 'PATCH', 'DELETE']

const CreateBody = z.object({ handle: z.string().min(1) })

const UpdateBody = z.object({
  handle: z.string().min(1).optional(),
  // null removes the recovery key; absent leaves it alone.
  recoveryKeyDid: z.string().min(1).nullable().optional(),
  // Required with recoveryKeyDid: a recovery key can move the account away.
  currentPassword: z.string().min(1).optional(),
  active: z.boolean().optional()
})

const DeleteBody = z.object({ confirmHandle: z.string().min(1) })

const forbidden = (req: NextRequest, error: string) =>
  apiResponse({
    req,
    allowedMethods: METHODS,
    data: { error },
    responseStatusCode: 403
  })

// The same step-up as an email change: a hijacked session alone must not be
// able to hand the account's identity to someone else's key. Answers the
// refusal, or null when the password checks out.
const checkCurrentPassword = async (
  req: NextRequest,
  actor: Actor,
  currentPassword: string | undefined
) => {
  const account = actor.account
  if (!account?.passwordHash) {
    return forbidden(
      req,
      'Set a password before changing your recovery key. Use "Forgot password" to set one; the link is sent to your email address.'
    )
  }
  const limit = await checkPasswordChangeRateLimit(account.id)
  if (!limit.allowed) {
    return apiRateLimitedResponse(req, limit.retryAfterSeconds, METHODS)
  }
  if (!currentPassword) {
    return forbidden(req, 'Current password is required')
  }
  if (!(await comparePassword(currentPassword, account.passwordHash))) {
    return forbidden(req, 'Current password is incorrect')
  }
  return null
}

// Tells the owner the recovery key changed. A failure is logged and does not
// fail the request: the PLC operation has already landed.
const sendRecoveryKeyNotice = async (
  database: Database,
  actor: Actor,
  handle: string | null,
  recoveryKeyDid: string | null
) => {
  const email = actor.account?.email
  if (!email || !handle) return
  try {
    const { brand, from, contactEmail } = await resolveEmailIdentity(
      database,
      getServedLinkDomain(actor.domain)
    )
    const notice = buildBlueskyRecoveryKeyNoticeEmail({
      recipientEmail: email,
      handle,
      recoveryKeyDid,
      contactEmail,
      brand
    })
    await sendMail({
      from,
      to: [email],
      subject: notice.subject,
      content: { text: notice.text, html: notice.html }
    })
  } catch (error) {
    logger.error({
      message: 'Failed to send the Bluesky recovery key notice',
      actorId: actor.id,
      err: toLoggableError(error)
    })
  }
}

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
    if (parsed.data.recoveryKeyDid !== undefined) {
      const refused = await checkCurrentPassword(
        req,
        currentActor,
        parsed.data.currentPassword
      )
      if (refused) return refused
    }
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
        const next = await setHostedBlueskyRecoveryKey({
          database,
          actor: currentActor,
          recoveryKeyDid: parsed.data.recoveryKeyDid
        })
        await sendRecoveryKeyNotice(
          database,
          currentActor,
          next.repo?.handle ?? null,
          parsed.data.recoveryKeyDid
        )
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
