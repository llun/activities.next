'use client'

import { useSearchParams } from 'next/navigation'
import { FC, useState } from 'react'

import { Button } from '@/lib/components/ui/button'
import { authClient } from '@/lib/services/auth/auth-client'

interface Props {
  provider: { id: string; name: string }
}

export const SigninButton: FC<Props> = ({ provider }) => {
  const [error, setError] = useState<string>()
  const searchParams = useSearchParams()
  const raw = searchParams.get('redirectBack')
  const redirectBack =
    raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/'

  return (
    <div className="space-y-1">
      <Button
        variant="outline"
        className="w-full"
        onClick={() => {
          setError(undefined)
          authClient.signIn.social({
            provider: provider.id as Parameters<
              typeof authClient.signIn.social
            >[0]['provider'],
            callbackURL: redirectBack,
            fetchOptions: {
              onError: () => {
                setError(
                  `Sign in with ${provider.name} failed. Please try again.`
                )
              }
            }
          })
        }}
      >
        Sign in with {provider.name}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
