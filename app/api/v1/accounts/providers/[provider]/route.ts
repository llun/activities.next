import { getServerSession } from 'next-auth'
import { NextRequest } from 'next/server'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { getDatabase } from '@/lib/database'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { apiErrorResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const DELETE = traceApiRoute(
  'unlinkProvider',
  async (
    req: NextRequest,
    props: { params: Promise<{ provider: string }> }
  ) => {
    const database = getDatabase()
    if (!database) {
      return apiErrorResponse(500)
    }

    const session = await getServerSession(getAuthOptions())
    const actor = await getActorFromSession(database, session)
    if (!actor || !actor.account) {
      return apiErrorResponse(401)
    }

    const { provider } = await props.params
    if (!provider) {
      return apiErrorResponse(404)
    }

    await database.unlinkAccountFromProvider({
      accountId: actor.account.id,
      provider
    })

    return Response.json({ success: true })
  },
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { provider: params?.provider || 'unknown' }
    }
  }
)
