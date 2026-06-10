import { NextRequest } from 'next/server'

import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/types/domain/actor'
import { Client } from '@/lib/types/oauth2/client'

export type AppRouterParams<P> = { params: Promise<P> }

export type AuthenticatedApiHandle<P> = (
  request: NextRequest,
  context: {
    database: Database
    currentActor: Actor
    params: Promise<P>
    grantedScopes?: string[]
    // OAuth client id behind a bearer token (null/undefined for web-session
    // requests). Lets handlers resolve the owning client, e.g. to record the
    // Mastodon "application" on a created status.
    clientId?: string | null
  }
) => Promise<Response> | Response

export type OptionalAuthenticatedApiHandle<P> = (
  request: NextRequest,
  context: {
    database: Database
    currentActor: Actor | null
    params: Promise<P>
    grantedScopes?: string[]
    clientId?: string | null
  }
) => Promise<Response> | Response

// App tokens (client_credentials) have no associated actor, so the actor is
// optional and the owning client is surfaced for app-level endpoints.
export type AuthenticatedAppApiHandle<P> = (
  request: NextRequest,
  context: {
    database: Database
    currentActor: Actor | null
    client: Client | null
    grantedScopes: string[]
    params: Promise<P>
  }
) => Promise<Response> | Response

export type ActivityPubVerifiedSenderHandle<P> = (
  request: NextRequest,
  context: {
    activityBody: unknown
    database: Database
    params: Promise<P>
    verifiedSenderActorId: string
  }
) => Promise<Response> | Response
