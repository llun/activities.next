import { z } from 'zod'

import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const UpdateNameRequest = z.object({
  name: z.string().trim()
})

export const POST = traceApiRoute(
  'updateAccountName',
  AuthenticatedGuard(async (req, context) => {
    const { database } = context
    const account = context.currentActor.account!

    const body = await req.formData()
    const json = Object.fromEntries(body.entries())
    const parsed = UpdateNameRequest.parse(json)

    await database.updateAccountName({
      accountId: account.id,
      name: parsed.name
    })

    const host = headerHost(req.headers)
    const url = new URL('/settings/account', `https://${host}`)
    return Response.redirect(url.toString(), 307)
  })
)
