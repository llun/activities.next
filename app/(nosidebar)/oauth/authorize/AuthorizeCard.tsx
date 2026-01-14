'use client'

import intersection from 'lodash/intersection'
import { useRouter } from 'next/navigation'
import { FC, useState } from 'react'

import { Button } from '@/lib/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/lib/components/ui/card'
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

  const handleActorChange = async (actorId: string) => {
    setSelectedActorId(actorId)
    // Switch to the selected actor
    await fetch('/api/v1/actors/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actorId })
    })
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
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-muted-foreground">
                Select actor
              </h3>
              <p className="text-xs text-muted-foreground">
                Choose which identity to authorize for this application
              </p>
              <div className="space-y-2">
                {actors.map((actor) => (
                  <div
                    key={actor.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                      selectedActorId === actor.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:bg-muted/50'
                    }`}
                    onClick={() => handleActorChange(actor.id)}
                  >
                    <input
                      type="radio"
                      name="selected_actor"
                      value={actor.id}
                      checked={selectedActorId === actor.id}
                      onChange={() => handleActorChange(actor.id)}
                      className="size-4"
                    />
                    <div className="flex-1">
                      <div className="font-medium">
                        {actor.name || actor.username}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        @{actor.username}@{actor.domain}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
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
