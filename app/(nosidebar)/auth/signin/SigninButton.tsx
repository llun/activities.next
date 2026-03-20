'use client'

import { useSearchParams } from 'next/navigation'
import { FC } from 'react'

import { Button } from '@/lib/components/ui/button'
import { authClient } from '@/lib/services/auth/auth-client'

interface Props {
  provider: { id: string; name: string }
}

export const SigninButton: FC<Props> = ({ provider }) => {
  const searchParams = useSearchParams()
  const redirectBack = searchParams.get('redirectBack') ?? undefined

  return (
    <Button
      variant="outline"
      className="w-full"
      onClick={() =>
        authClient.signIn.social({
          provider: provider.id as 'github',
          callbackURL: redirectBack
        })
      }
    >
      Sign in with {provider.name}
    </Button>
  )
}
