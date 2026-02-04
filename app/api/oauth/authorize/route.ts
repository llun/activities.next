import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { getOAuth2Server } from '@/lib/services/oauth/server'
import { User } from '@/lib/types/oauth2/user'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const runtime = 'nodejs'

export const POST = traceApiRoute(
  'authorizeApp',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor } = context
    const server = await getOAuth2Server()
    const form = await req.formData()
    const query = {
      ...Object.fromEntries(form.entries()),
      scope: form.getAll('scope')
    }
    const authRequest = await server.validateAuthorizationRequest({
      headers: Object.fromEntries(req.headers.entries()),
      query,
      body: {}
    })
    authRequest.user = User.parse({
      id: currentActor.id,
      actor: currentActor,
      account: currentActor.account
    })
    authRequest.isAuthorizationApproved = true
    const oauthResponse = await server.completeAuthorizationRequest(authRequest)
    return Response.redirect(oauthResponse.headers.location)
  })
)
