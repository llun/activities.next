import { redirect } from 'next/navigation'
import { z } from 'zod'

import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const UpdateImageRequest = z.object({
  iconUrl: z
    .string()
    .trim()
    .url()
    .transform((v) => v || null)
    .nullable()
    .optional()
})

export const POST = traceApiRoute(
  'updateAccountImage',
  AuthenticatedGuard(async (req, context) => {
    const { database } = context
    const account = context.currentActor.account!

    const formData = await req.formData()
    const parsed = UpdateImageRequest.safeParse({
      iconUrl: formData.get('iconUrl') || null
    })

    if (!parsed.success) {
      redirect('/settings/account')
    }

    await database.updateAccountImage({
      accountId: account.id,
      iconUrl: parsed.data.iconUrl ?? null
    })

    redirect('/settings/account')
  })
)
