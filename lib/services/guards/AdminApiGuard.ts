import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { Database } from '@/lib/database/types'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { Scope } from '@/lib/types/database/operations'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'
import { HttpMethod } from '@/lib/utils/http-headers'
import { HTTP_STATUS, apiResponse } from '@/lib/utils/response'

import { hasSameOriginProof } from './sameOriginProof'
import { AppRouterParams } from './types'

// The acting moderator's identity, threaded through to handlers so report
// assignment and the moderation audit log can record provenance. Either id may
// be null: a bearer app token has no actor, and a cookie-session admin whose
// account has no default actor resolves actorId null (handlers that need an
// actor — e.g. assign_to_self — 422 in that case).
export type AdminModerator = {
  accountId: string | null
  actorId: string | null
}

type AdminApiHandle<P> = (
  request: NextRequest,
  context: {
    database: Database
    params: Promise<P>
    moderator: AdminModerator
  }
) => Promise<Response> | Response

// Admin endpoints accept the coarse read/write scopes (backwards compatibility
// for tokens with plain read/write) or the Mastodon aggregate admin scopes
// (admin:read for GET, admin:write for mutations). The actor's admin role
// checked inside the guard is the real authorization gate.
//
// A route may additionally opt into its own resource-specific granular admin
// scope by passing `{ resource }`. Only that resource's scope is accepted, so a
// token consented for admin:read:domain_blocks does not gain access to unrelated
// admin resources — that isolation is why granular admin scopes are opt-in per
// route rather than accepting every admin:read:* / admin:write:* globally.
const RESOURCE_ADMIN_SCOPES = {
  domain_blocks: {
    read: Scope.enum['admin:read:domain_blocks'],
    write: Scope.enum['admin:write:domain_blocks']
  },
  domain_allows: {
    read: Scope.enum['admin:read:domain_allows'],
    write: Scope.enum['admin:write:domain_allows']
  },
  accounts: {
    read: Scope.enum['admin:read:accounts'],
    write: Scope.enum['admin:write:accounts']
  },
  reports: {
    read: Scope.enum['admin:read:reports'],
    write: Scope.enum['admin:write:reports']
  }
} as const

type AdminResource = keyof typeof RESOURCE_ADMIN_SCOPES

type AdminApiGuardOptions = {
  // Accept this resource's granular admin scope in addition to the coarse and
  // aggregate admin scopes, without widening any other admin route.
  resource?: AdminResource
}

const getRequiredOAuthScopes = (
  method: string,
  options: AdminApiGuardOptions = {}
): Scope[] => {
  const granular = options.resource
    ? RESOURCE_ADMIN_SCOPES[options.resource]
    : undefined
  return method === HttpMethod.enum.GET
    ? [
        Scope.enum.read,
        Scope.enum['admin:read'],
        ...(granular ? [granular.read] : [])
      ]
    : [
        Scope.enum.write,
        Scope.enum['admin:write'],
        ...(granular ? [granular.write] : [])
      ]
}

export const AdminApiGuard =
  <P>(
    allowedMethods: HttpMethod[],
    handle: AdminApiHandle<P>,
    options: AdminApiGuardOptions = {}
  ) =>
  async (req: NextRequest, context: AppRouterParams<P>) => {
    const database = getDatabase()
    if (!database) {
      return apiResponse({
        req,
        allowedMethods,
        data: { error: 'Database unavailable' },
        responseStatusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR
      })
    }

    const session = await getServerAuthSession()
    const admin = await getAdminFromSession(database, session)
    if (admin) {
      // Cookie-session admin mutations need the same CSRF same-origin proof
      // as AuthenticatedGuard; bearer-token requests below are not at risk.
      if (!hasSameOriginProof(req)) {
        return apiResponse({
          req,
          allowedMethods,
          data: { error: 'Forbidden' },
          responseStatusCode: HTTP_STATUS.FORBIDDEN
        })
      }
      return handle(req, {
        database,
        params: context.params,
        // Cookie-session admin: the account has no actor of its own, so use its
        // default actor id (null when unset — the actor-requiring handlers 422).
        moderator: {
          accountId: admin.id,
          actorId: admin.defaultActorId ?? null
        }
      })
    }

    if (!req.headers.get('Authorization')) {
      return apiResponse({
        req,
        allowedMethods,
        data: { error: 'Forbidden' },
        responseStatusCode: HTTP_STATUS.FORBIDDEN
      })
    }

    const { OAuthGuardAnyScope } = await import('./OAuthGuard')
    return OAuthGuardAnyScope<P>(
      getRequiredOAuthScopes(req.method, options),
      async (oauthReq, { currentActor, database: oauthDatabase, params }) => {
        if (currentActor.account?.role !== 'admin') {
          return apiResponse({
            req: oauthReq,
            allowedMethods,
            data: { error: 'Forbidden' },
            responseStatusCode: HTTP_STATUS.FORBIDDEN
          })
        }

        return handle(oauthReq, {
          database: oauthDatabase,
          params,
          moderator: {
            accountId: currentActor.account?.id ?? null,
            actorId: currentActor.id
          }
        })
      }
    )(req, context)
  }
