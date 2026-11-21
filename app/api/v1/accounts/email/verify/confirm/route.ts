import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { hashPasswordResetCode } from '@/lib/services/auth/passwordResetCode'
import { hasSameOriginProof } from '@/lib/services/guards/sameOriginProof'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

// The email-change link opens `/account/verify-email`, whose GET is read-only.
// This route performs the change when the reader presses the page's confirm
// button. It is code-based rather than session-based (the link may be opened
// signed out), so the code is the credential and same-origin proof is the CSRF
// guard.
const redirectTo = (req: NextRequest, status: 'verified' | 'invalid') =>
  Response.redirect(
    new URL(`/account/verify-email?status=${status}`, req.url),
    303
  )

export const POST = traceApiRoute(
  'confirmEmailChange',
  async (req: NextRequest) => {
    if (!hasSameOriginProof(req)) {
      return new Response(null, { status: 403 })
    }

    const database = getDatabase()
    if (!database) {
      return new Response(null, { status: 500 })
    }

    let code: string | null
    try {
      const formData = await req.formData()
      const value = formData.get('code')
      code = typeof value === 'string' ? value : null
    } catch {
      return redirectTo(req, 'invalid')
    }
    if (!code) return redirectTo(req, 'invalid')

    try {
      const account = await database.verifyEmailChange({
        // The link carries the raw code; the row stores its HMAC.
        emailChangeCode: hashPasswordResetCode(code)
      })
      return redirectTo(req, account ? 'verified' : 'invalid')
    } catch (error) {
      logger.error({
        message: 'Failed to confirm email change',
        err: toLoggableError(error)
      })
      return new Response(null, { status: 500 })
    }
  }
)
