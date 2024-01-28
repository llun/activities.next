'use client'

import { ClientSafeProvider, signIn } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { FC } from 'react'

import { Button } from '@/lib/components/Button'

interface Props {
  provider: ClientSafeProvider
}

export const SigninButton: FC<Props> = ({ provider }) => {
  const searchParams = useSearchParams()
  const redirectBack = searchParams.get('redirectBack') ?? undefined

  return (
    <div className="mb-2">
      <Button
        onClick={() => signIn(provider.id, { callbackUrl: redirectBack })}
      >
        Sign in with {provider.name}
      </Button>
    </div>
  )
}
