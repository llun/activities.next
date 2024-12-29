'use client'

import { signIn } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { FC } from 'react'

import { Button } from '@/lib/components/Button'

interface Props {
  providerId: string
  providerName: string
}

export const SigninButton: FC<Props> = ({ providerId, providerName }) => {
  const searchParams = useSearchParams()
  const redirectBack = searchParams.get('redirectBack') ?? undefined

  return (
    <div className="mb-2">
      <Button onClick={() => signIn(providerId, { callbackUrl: redirectBack })}>
        Sign in with {providerName}
      </Button>
    </div>
  )
}
