'use client'

import { ClientSafeProvider, signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { FC } from 'react'

import { Button } from '@/lib/components/ui/button'

interface AuthenticationProvidersProps {
  nonCredentialsProviders: ClientSafeProvider[]
  connectedProviders: {
    provider: string
    providerId: string
    createdAt: number
    updatedAt: number
  }[]
}

export const AuthenticationProviders: FC<AuthenticationProvidersProps> = ({
  nonCredentialsProviders,
  connectedProviders
}) => {
  const router = useRouter()
  if (!nonCredentialsProviders.length) return

  return (
    <div className="space-y-2">
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
            <Button onClick={() => signIn(provider.id)}>
              Connect to {provider.name}
            </Button>
          </div>
        )
      })}
    </div>
  )
}
