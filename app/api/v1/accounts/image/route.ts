import { z } from 'zod'

import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const UpdateImageRequest = z.object({
  iconUrl: z.preprocess(
    (val) => (val === '' ? null : val),
    z.string().trim().url().max(255).nullable().optional()
  )
})

export const POST = traceApiRoute(
  'updateAccountImage',
  AuthenticatedGuard(async (req, context) => {
    const { database } = context
    const account = context.currentActor.account!

    const formData = await req.formData()
    const parsed = UpdateImageRequest.safeParse({
      iconUrl: formData.get('iconUrl') ?? null
    })

    if (!parsed.success) {
      return Response.redirect(
        new URL('/settings/account?error=Invalid+image+URL', req.url),
        303
      )
    }

    await database.updateAccountImage({
      accountId: account.id,
      iconUrl: parsed.data.iconUrl ?? null
    })

    return Response.redirect(new URL('/settings/account', req.url), 303)
  })
)
