import { getConfig } from '@/lib/config'
import { parseProfileImageUrl } from '@/lib/services/accounts/profileImageUrl'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const POST = traceApiRoute(
  'updateAccountImage',
  AuthenticatedGuard(async (req, context) => {
    const { database } = context
    const account = context.currentActor.account!

    const invalidImageUrl = () =>
      Response.redirect(
        new URL('/account?error=Invalid+image+URL', req.url),
        303
      )

    const formData = await req.formData()
    const rawIconUrl = formData.get('iconUrl')
    // An uploaded file in this field is a malformed request, not a value to
    // store — `formData.get` answers null only when the field is absent.
    if (rawIconUrl !== null && typeof rawIconUrl !== 'string') {
      return invalidImageUrl()
    }

    // Shares one rule with POST /api/v1/accounts/profile: only a URL naming
    // media this instance already stores. This route previously validated with
    // `z.string().url()`, which in Zod 4 accepts `javascript:`, `data:` and
    // `file:` URLs — so the shape check alone left the schemes worth refusing.
    // A missing or empty value still clears the image, as it always has.
    const iconUrl = parseProfileImageUrl(rawIconUrl, getConfig())
    if (!iconUrl.valid) return invalidImageUrl()

    await database.updateAccountImage({
      accountId: account.id,
      iconUrl: iconUrl.value ?? null
    })

    return Response.redirect(new URL('/account', req.url), 303)
  })
)
