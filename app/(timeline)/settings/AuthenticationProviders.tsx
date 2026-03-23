'use client'

import { useRouter } from 'next/navigation'
import { FC, useState } from 'react'

import { Button } from '@/lib/components/ui/button'
import { authClient } from '@/lib/services/auth/auth-client'

interface ProviderInfo {
  id: string
  name: string
}

interface AuthenticationProvidersProps {
  nonCredentialsProviders: ProviderInfo[]
  connectedProviders: {
    provider: string
    providerId: string
    createdAt: number
    updatedAt: number
  }[]
  callbackURL?: string
}

export const AuthenticationProviders: FC<AuthenticationProvidersProps> = ({
  nonCredentialsProviders,
  connectedProviders,
  callbackURL = '/settings'
}) => {
  const router = useRouter()
  const [error, setError] = useState<string>()
  if (!nonCredentialsProviders.length) return

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {nonCredentialsProviders.map((provider) => {
        const isConnected = connectedProviders.some(
          (connected) => connected.provider === provider.id
        )

        if (isConnected) {
          return (
            <div
              key={provider.name}
              className="flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">
                  Connected to {provider.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  (
                  {
                    connectedProviders.find((p) => p.provider === provider.id)
                      ?.providerId
                  }
                  )
                </span>
              </div>
              <Button
                variant="destructive"
                onClick={async () => {
                  await fetch(`/api/v1/accounts/providers/${provider.id}`, {
                    method: 'DELETE'
                  })
                  router.refresh()
                }}
              >
                Disconnect
              </Button>
            </div>
          )
        }

        return (
          <div key={provider.name} className="flex justify-end">
            <Button
              onClick={() => {
                setError(undefined)
                authClient.linkSocial({
                  provider: provider.id as Parameters<
                    typeof authClient.linkSocial
                  >[0]['provider'],
                  callbackURL,
                  fetchOptions: {
                    onError: () => {
                      setError(
                        `Failed to connect to ${provider.name}. Please try again.`
                      )
                    }
                  }
                })
              }}
            >
              Connect to {provider.name}
            </Button>
          </div>
        )
      })}
    </div>
  )
}
