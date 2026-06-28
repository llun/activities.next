'use client'

import intersection from 'lodash/intersection'
import { Check, ChevronDown } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { FC, useState } from 'react'

import { switchActor } from '@/lib/client'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { Button } from '@/lib/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/lib/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/lib/components/ui/dropdown-menu'
import { Label } from '@/lib/components/ui/label'
import { UsableScopes } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
import { Client } from '@/lib/types/oauth2/client'

import { buildOAuthQuery } from './authorizeQuery'
import { SearchParams } from './types'

interface AccountSummary {
  email: string
  name?: string | null
  iconUrl?: string | null
}

interface Props {
  client: Client
  searchParams: SearchParams
  actors: Actor[]
  account: AccountSummary
  currentActorId: string
  navigate?: (url: string) => void
}

interface ConsentResponse {
  redirect?: boolean
  url?: string
  // Legacy shape from the original custom consent handler.
  redirect_uri?: string
}

export const getConsentRedirectUrl = (data: ConsentResponse) => {
  const redirectUrl = data.url ?? data.redirect_uri
  if (!redirectUrl) return undefined

  try {
    const parsed = new URL(redirectUrl)
    if (['javascript:', 'data:', 'vbscript:'].includes(parsed.protocol)) {
      return undefined
    }
    return parsed.toString()
  } catch {
    // Invalid redirect response; fall through to the existing error handling.
  }

  return undefined
}

const getCurrentOAuthQuery = (fallbackSearchParams: SearchParams) => {
  if (typeof window === 'undefined') {
    return buildOAuthQuery(fallbackSearchParams)
  }

  const currentQuery = window.location.search.slice(1)
  return currentQuery || buildOAuthQuery(fallbackSearchParams)
}

const navigateTo = (url: string) => {
  window.location.href = url
}

export const AuthorizeCard: FC<Props> = ({
  searchParams,
  client,
  actors,
  account,
  currentActorId,
  navigate = navigateTo
}) => {
  const requestedScopes = searchParams.scope.split(' ')
  const router = useRouter()
  const availabledScopes = intersection(UsableScopes, requestedScopes)
  // An OIDC authentication request is identified by the `openid` scope (OIDC
  // Core §3.1.2.1). Such a request authenticates the owning account, not a
  // chosen ActivityPub persona — the id_token/userinfo `sub` is always the
  // account id — so the consent screen shows the fixed account identity instead
  // of the multi-actor "Authorize as" picker.
  const isOidc = requestedScopes.includes('openid')
  const accountDisplayName = account.name?.trim() || account.email
  const [selectedActorId, setSelectedActorId] = useState(currentActorId)
  const [isSwitching, setIsSwitching] = useState(false)
  const [submittingAction, setSubmittingAction] = useState<
    'approve' | 'deny' | null
  >(null)
  const isSubmitting = submittingAction !== null

  const selectedActor =
    actors.find((a) => a.id === selectedActorId) || actors[0]

  const getAvatarInitial = (username: string) => {
    if (!username) return '?'
    // Spread to the first code point so a surrogate-pair glyph (emoji or a
    // non-BMP character starting a name) isn't sliced into a broken half.
    return [...username][0].toUpperCase()
  }

  const getHandle = (actor: Actor) => `@${actor.username}@${actor.domain}`

  const handleActorChange = async (actorId: string) => {
    if (actorId === selectedActorId || isSwitching) return

    setIsSwitching(true)
    try {
      const ok = await switchActor({ actorId })
      if (ok) {
        setSelectedActorId(actorId)
      }
    } catch {
      // Network error — silently ignore; the UI remains on the current actor
    } finally {
      setIsSwitching(false)
    }
  }

  const persistSelectedActor = async () =>
    switchActor({ actorId: selectedActorId })

  const redirectWithError = (error: string) => {
    const redirectUri = searchParams.redirect_uri
    if (redirectUri) {
      try {
        const errorUrl = new URL(redirectUri)
        errorUrl.searchParams.set('error', error)
        if (searchParams.state) {
          errorUrl.searchParams.set('state', searchParams.state)
        }
        navigate(errorUrl.toString())
        return
      } catch {
        // Malformed redirect_uri — fall through to router push
      }
    }
    router.push(client.website ?? '/')
  }

  const handleApprove = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (submittingAction || isSwitching) return
    setSubmittingAction('approve')

    try {
      const formData = new FormData(e.currentTarget)
      const selectedScopes = formData.getAll('scope') as string[]
      if (!(await persistSelectedActor())) {
        redirectWithError('server_error')
        return
      }

      const response = await fetch('/api/auth/oauth2/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accept: true,
          scope: selectedScopes.join(' '),
          oauth_query: getCurrentOAuthQuery(searchParams)
        })
      })

      if (response.ok) {
        const data = (await response.json()) as ConsentResponse
        const redirectUrl = getConsentRedirectUrl(data)
        if (redirectUrl) {
          navigate(redirectUrl)
          return
        }
      }

      redirectWithError('server_error')
    } catch {
      redirectWithError('server_error')
    } finally {
      setSubmittingAction(null)
    }
  }

  const handleDeny = async () => {
    if (submittingAction || isSwitching) return
    setSubmittingAction('deny')
    try {
      const response = await fetch('/api/auth/oauth2/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accept: false,
          oauth_query: getCurrentOAuthQuery(searchParams)
        })
      })
      if (response.ok) {
        const data = (await response.json()) as ConsentResponse
        const redirectUrl = getConsentRedirectUrl(data)
        if (redirectUrl) {
          navigate(redirectUrl)
          return
        }
        // Denial processed but no redirect — use access_denied
        redirectWithError('access_denied')
        return
      }
      // Server returned non-ok — infrastructure failure
      redirectWithError('server_error')
    } catch {
      redirectWithError('server_error')
    } finally {
      setSubmittingAction(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Authorization required</CardTitle>
        <CardDescription>
          <strong>{client.name}</strong> would like permission to access your
          account. It is a third-party application.{' '}
          <strong>
            If you do not trust it, then you should not authorize it.
          </strong>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleApprove} className="space-y-6">
          {isOidc && (
            <div className="space-y-2">
              {/* Informational caption — not a form-control label, so a <p>
                  rather than <Label> (which would label nothing). */}
              <p className="text-sm font-medium text-muted-foreground">
                Signed in as
              </p>
              <div className="flex w-full items-center gap-3 rounded-lg border bg-background p-3">
                <Avatar className="h-10 w-10" aria-hidden="true">
                  {account.iconUrl && <AvatarImage src={account.iconUrl} />}
                  <AvatarFallback className="bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                    {getAvatarInitial(accountDisplayName)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 overflow-hidden">
                  <p className="text-sm font-medium truncate">
                    {accountDisplayName}
                  </p>
                  {/* Show the email as a secondary line only when a distinct
                      name is the primary identity. Covers name=null, blank, and
                      name===email (which would otherwise render twice). */}
                  {accountDisplayName !== account.email && (
                    <p className="text-xs text-muted-foreground truncate">
                      {account.email}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {!isOidc && actors.length > 1 && (
            <div className="space-y-2">
              <Label className="text-sm font-medium text-muted-foreground">
                Authorize as
              </Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-lg border bg-background p-3 text-left transition-colors hover:bg-muted"
                    disabled={isSwitching}
                  >
                    <Avatar className="h-10 w-10">
                      {selectedActor?.iconUrl && (
                        <AvatarImage src={selectedActor.iconUrl} />
                      )}
                      <AvatarFallback className="bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                        {getAvatarInitial(selectedActor?.username || '')}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 overflow-hidden">
                      <p className="text-sm font-medium truncate">
                        {selectedActor?.name || selectedActor?.username}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {selectedActor && getHandle(selectedActor)}
                      </p>
                    </div>
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-[300px]">
                  {actors.map((actor) => (
                    <DropdownMenuItem
                      key={actor.id}
                      onClick={() => handleActorChange(actor.id)}
                      disabled={isSwitching}
                      className="flex items-center gap-3"
                    >
                      <Avatar className="h-8 w-8">
                        {actor.iconUrl && <AvatarImage src={actor.iconUrl} />}
                        <AvatarFallback className="bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300 text-xs">
                          {getAvatarInitial(actor.username)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 overflow-hidden">
                        <p className="text-sm font-medium truncate">
                          {actor.name || actor.username}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {getHandle(actor)}
                        </p>
                      </div>
                      {actor.id === selectedActorId && (
                        <Check className="h-4 w-4 text-primary" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}

          <div className="space-y-4">
            <h3 className="text-sm font-medium text-muted-foreground">
              Review permissions
            </h3>
            <div className="space-y-3">
              {availabledScopes.map((scope) => {
                // `openid` is what makes this an OIDC authentication request and
                // gates id_token issuance, so it must not be strippable. Render
                // it locked (disabled + checked) and submit it via a hidden
                // field so a disabled checkbox (which a browser omits from form
                // data) can't silently drop it. Optional OIDC scopes
                // (profile/email) stay user-toggleable.
                const lockedOidcScope = isOidc && scope === 'openid'
                return (
                  <div key={scope} className="flex items-center space-x-2">
                    <input
                      className="size-4 rounded border-input text-primary focus:ring-2 focus:ring-ring focus:ring-offset-2"
                      name="scope"
                      type="checkbox"
                      value={scope}
                      id={`scope-${scope}`}
                      defaultChecked
                      disabled={lockedOidcScope}
                    />
                    {lockedOidcScope && (
                      <input type="hidden" name="scope" value={scope} />
                    )}
                    <Label
                      htmlFor={`scope-${scope}`}
                      className="text-sm font-normal leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      {scope}
                    </Label>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              className="flex-1"
              variant="outline"
              type="button"
              onClick={handleDeny}
              disabled={isSubmitting || isSwitching}
            >
              {submittingAction === 'deny' ? 'Denying...' : 'Deny'}
            </Button>
            <Button
              className="flex-1"
              type="submit"
              disabled={isSubmitting || isSwitching}
            >
              {submittingAction === 'approve' ? 'Approving...' : 'Approve'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
