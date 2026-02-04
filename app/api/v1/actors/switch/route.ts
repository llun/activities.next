import { getServerSession } from 'next-auth'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { getDatabase } from '@/lib/database'
import { HTTP_STATUS, apiErrorResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const SwitchActorRequest = z.object({
  actorId: z.string().min(1)
})

export const POST = traceApiRoute('switchActor', async (req: NextRequest) => {
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
    return NextResponse.json(
      { error: 'Actor not found or not owned by account' },
      { status: HTTP_STATUS.NOT_FOUND }
    )
  }

  // Check if actor is pending deletion or being deleted
  if (validActor.deletionStatus) {
    return NextResponse.json(
      {
        error:
          'Cannot switch to an actor that is pending deletion or being deleted'
      },
      { status: HTTP_STATUS.BAD_REQUEST }
    )
  }

  // Set a cookie to track the selected actor
  const cookieStore = await cookies()
  const isSecure = req.url.startsWith('https')
  cookieStore.set('activities.actor-id', actorId, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30 // 30 days
  })

  return NextResponse.json({
    id: validActor.id,
    username: validActor.username,
    domain: validActor.domain,
    name: validActor.name,
    iconUrl: validActor.iconUrl
  })
})
