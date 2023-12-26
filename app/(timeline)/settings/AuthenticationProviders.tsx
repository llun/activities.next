'use client'

import { ClientSafeProvider, signIn } from 'next-auth/react'
import { FC } from 'react'

import { Button } from '@/lib/components/Button'

interface AuthenticationProvidersProps {
  nonCredentialsProviders: ClientSafeProvider[]
}

export const AuthenticationProviders: FC<AuthenticationProvidersProps> = ({
  nonCredentialsProviders
}) => {
  if (!nonCredentialsProviders.length) return

  return (
    <div>
      <hr />
      {nonCredentialsProviders.map((provider) => (
        <div key={provider.name} className="mb-2">
          <Button onClick={() => signIn(provider.id)}>
            Connect to {provider.name}
          </Button>
        </div>
      ))}
    </div>
  )
}
