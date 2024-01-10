'use client'

import { ClientSafeProvider, signIn } from 'next-auth/react'
import { FC } from 'react'

import { Button } from '@/lib/components/Button'

interface Props {
  provider: ClientSafeProvider
}

export const SigninButton: FC<Props> = ({ provider }) => (
  <div className="mb-2">
    <Button onClick={() => signIn(provider.id)}>
      Sign in with {provider.name}
    </Button>
  </div>
)
