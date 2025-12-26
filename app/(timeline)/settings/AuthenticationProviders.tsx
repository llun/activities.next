'use client'

import { ClientSafeProvider, signIn } from 'next-auth/react'
import { FC } from 'react'

import { Button } from '@/lib/components/ui/button'

interface AuthenticationProvidersProps {
  nonCredentialsProviders: ClientSafeProvider[]
}

export const AuthenticationProviders: FC<AuthenticationProvidersProps> = ({
  nonCredentialsProviders
}) => {
  if (!nonCredentialsProviders.length) return

  return (
    <div className="space-y-2">
      {nonCredentialsProviders.map((provider) => (
        <div key={provider.name}>
          <Button onClick={() => signIn(provider.id)}>
            Connect to {provider.name}
          </Button>
        </div>
      ))}
    </div>
  )
}
