import { NextRequest } from 'next/server'

import { Actor } from '@/lib/types/domain/actor'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse } from '@/lib/utils/response'

export const ACCOUNT_MOVED_ERROR = 'This account has moved'

// Mastodon: a moved account can still sign in, export and change settings, but
// is no longer "functional", so every posting endpoint refuses it.
export const isMovedActor = (actor: Pick<Actor, 'movedTo'>) =>
  Boolean(actor.movedTo)

// The 422 a posting entry point returns for a moved author, or null to proceed.
export const movedAccountResponse = (
  req: NextRequest,
  allowedMethods: HttpMethod[],
  actor: Pick<Actor, 'movedTo'>
) =>
  isMovedActor(actor)
    ? apiResponse({
        req,
        allowedMethods,
        data: { error: ACCOUNT_MOVED_ERROR },
        responseStatusCode: 422
      })
    : null
