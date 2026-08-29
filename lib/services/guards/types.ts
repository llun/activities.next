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
    // The account the token was issued for; null for a genuine app
    // (client_credentials) token. This — not `currentActor` — is what tells the
    // two apart, and it is the single owner of that rule: the other two sites
    // that care point here rather than restating it.
    //
    // `OAuthAppGuard` leaves `currentActor` null in two unrelated cases: a real
    // app token, which has no user; and a user-delegated token whose actor it
    // merely FAILED to resolve — the grant recorded no `referenceId` and
    // `resolveAccountActorId` found no selectable actor, which happens when
    // every actor the account owns is pending deletion (`selectAccountActor`
    // skips those). Reading `currentActor` conflates them, and that let a user
    // be accepted as an app and mint accounts.
    userId: string | null
    params: Promise<P>
  }
) => Promise<Response> | Response

export type ActivityPubVerifiedSenderHandle<P> = (
  request: NextRequest,
  context: {
    activityBody: unknown
    database: Database
    // True when the HTTP-signature key owner is NOT the activity's `actor`,
    // i.e. the delivery was FORWARDED by another server (AP §7.1.2 inbox
    // forwarding — Mastodon fans a reply's Create/Delete out to the thread
    // owner's followers signed with the thread owner's key). The payload's
    // authorship is unverified: handlers must route such activities
    // through origin re-fetch verification (processForwardedActivityJob) and
    // never apply payload-trusting side effects for them.
    forwarded: boolean
    params: Promise<P>
    verifiedSenderActorId: string
  }
) => Promise<Response> | Response
