import { ERROR_400 } from '../../../../../lib/errors'
import { AuthenticatedGuard } from '../../../../../lib/guard'

export const POST = AuthenticatedGuard(async (req, context) => {
  return Response.json(ERROR_400, { status: 400 })
})
