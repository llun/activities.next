'use client'

import { signIn } from 'next-auth/react'
import { FC } from 'react'

import { Button } from '@/lib/components/Button'
import { Provider } from '@/lib/types/nextauth'

interface AuthenticationProvidersProps {
  nonCredentialsProviders: Provider[]
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
