'use client'

import { ClientSafeProvider, getCsrfToken } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { FC, useEffect, useState } from 'react'

import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Label } from '@/lib/components/ui/label'

import { getSigninCallbackUrl } from './getSigninCallbackUrl'

interface Props {
  provider: ClientSafeProvider
}

export const CredentialForm: FC<Props> = ({ provider }) => {
  const [csrfToken, setCsrfToken] = useState<string>()
  const searchParams = useSearchParams()

  useEffect(() => {
    getCsrfToken().then((token) => setCsrfToken(token))
  }, [provider])

  return (
    <form
      method="post"
      action={getSigninCallbackUrl(provider, searchParams)}
      className="space-y-4"
    >
      <input name="csrfToken" type="hidden" value={csrfToken ?? ''} readOnly />
      <div className="space-y-2">
        <Label htmlFor="inputEmail">Email</Label>
        <Input name="email" type="email" id="inputEmail" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="inputPassword">Password</Label>
        <Input name="password" type="password" id="inputPassword" />
      </div>

      <Button type="submit" className="w-full">
        Sign in with {provider.name}
      </Button>
    </form>
  )
}
