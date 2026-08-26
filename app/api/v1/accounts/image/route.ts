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
    // A missing or empty value still clears the image, as it always has, and
    // the stored value is passed so a form resubmitting one it did not change
    // is treated as "no change" rather than re-validated.
    const iconUrl = parseProfileImageUrl(
      rawIconUrl,
      getConfig(),
      account.iconUrl
    )
    if (!iconUrl.valid) return invalidImageUrl()

    // `undefined` means the submitted value is the one already stored, so
    // there is nothing to write. `updateAccountImage` has no "no change" state
    // — it always writes — and `undefined ?? null` would CLEAR the image.
    if (iconUrl.value !== undefined) {
      await database.updateAccountImage({
        accountId: account.id,
        iconUrl: iconUrl.value
      })
    }

    return Response.redirect(new URL('/account', req.url), 303)
  })
)
