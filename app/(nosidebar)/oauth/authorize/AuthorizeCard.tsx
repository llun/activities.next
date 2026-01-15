'use client'

import intersection from 'lodash/intersection'
import { Check, ChevronDown } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { FC, useState } from 'react'

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
import { UsableScopes } from '@/lib/database/types/oauth'
import { Actor } from '@/lib/models/actor'
import { Client } from '@/lib/models/oauth2/client'

import { SearchParams } from './types'

interface Props {
  client: Client
  searchParams: SearchParams
  actors: Actor[]
  currentActorId: string
}

export const AuthorizeCard: FC<Props> = ({
  searchParams,
  client,
  actors,
  currentActorId
}) => {
  const requestedScopes = searchParams.scope.split(' ')
  const router = useRouter()
  const availabledScopes = intersection(UsableScopes, requestedScopes)
  const [selectedActorId, setSelectedActorId] = useState(currentActorId)
  const [isSwitching, setIsSwitching] = useState(false)

  const selectedActor =
    actors.find((a) => a.id === selectedActorId) || actors[0]

  const getAvatarInitial = (username: string) => {
    if (!username) return '?'
    return username[0].toUpperCase()
  }

  const getHandle = (actor: Actor) => `@${actor.username}@${actor.domain}`

  const handleActorChange = async (actorId: string) => {
    if (actorId === selectedActorId || isSwitching) return

    setIsSwitching(true)
    try {
      const response = await fetch('/api/v1/actors/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId })
      })
      if (response.ok) {
        setSelectedActorId(actorId)
      }
    } finally {
      setIsSwitching(false)
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
        <form action="/api/oauth/authorize" method="post" className="space-y-6">
          {actors.length > 1 && (
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
              {availabledScopes.map((scope) => (
                <div key={scope} className="flex items-center space-x-2">
                  <input
                    className="size-4 rounded border-input text-primary focus:ring-2 focus:ring-ring focus:ring-offset-2"
                    name="scope"
                    type="checkbox"
                    value={scope}
                    id={`scope-${scope}`}
                    defaultChecked
                  />
                  <Label
                    htmlFor={`scope-${scope}`}
                    className="text-sm font-normal leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    {scope}
                  </Label>
                </div>
              ))}
            </div>
          </div>

          <input
            type="hidden"
            name="client_id"
            value={searchParams.client_id}
          />
          <input
            type="hidden"
            name="redirect_uri"
            value={searchParams.redirect_uri}
          />
          <input
            type="hidden"
            name="response_type"
            value={searchParams.response_type}
          />

          <div className="flex gap-2">
            <Button className="flex-1" type="submit">
              Approve
            </Button>
            <Button
              className="flex-1"
              variant="destructive"
              type="button"
              onClick={() => {
                router.push(client.website ?? '/')
              }}
            >
              Deny
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
