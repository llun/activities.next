import { getServerSession } from 'next-auth'
import { cookies } from 'next/headers'
import { NextRequest } from 'next/server'
import { z } from 'zod'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { getDatabase } from '@/lib/database'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse
} from '@/lib/utils/response'

const SwitchActorRequest = z.object({
  actorId: z.string().min(1)
})

export async function POST(req: NextRequest) {
  const database = getDatabase()
  const session = await getServerSession(getAuthOptions())

  if (!database || !session?.user?.email) {
    return apiErrorResponse(HTTP_STATUS.UNAUTHORIZED)
  }

  const body = await req.json()
  const parsed = SwitchActorRequest.safeParse(body)

  if (!parsed.success) {
    return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
  }

  const { actorId } = parsed.data

  const account = await database.getAccountFromEmail({
    email: session.user.email
  })
  if (!account) {
    return apiErrorResponse(HTTP_STATUS.UNAUTHORIZED)
  }

  const actors = await database.getActorsForAccount({ accountId: account.id })
  const validActor = actors.find((actor) => actor.id === actorId)
  if (!validActor) {
    return apiResponse({
      req,
      allowedMethods: ['POST'],
      data: { error: 'Actor not found or not owned by account' },
      responseStatusCode: HTTP_STATUS.NOT_FOUND
    })
  }

  const cookieStore = await cookies()
  const sessionToken =
    cookieStore.get('next-auth.session-token')?.value ||
    cookieStore.get('__Secure-next-auth.session-token')?.value

  if (sessionToken) {
    await database.setSessionActor({ token: sessionToken, actorId })
  }

  return apiResponse({
    req,
    allowedMethods: ['POST'],
    data: {
      id: validActor.id,
      username: validActor.username,
      domain: validActor.domain,
      name: validActor.name,
      iconUrl: validActor.iconUrl
    }
  })
}
