'use client'

import { ClientSafeProvider, getCsrfToken } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { FC, useEffect, useState } from 'react'

import { Button } from '@/lib/components/Button'

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
    <div key={provider.name} className="mb-2">
      <form method="post" action={getSigninCallbackUrl(provider, searchParams)}>
        <input name="csrfToken" type="hidden" defaultValue={csrfToken ?? ''} />
        <div className="mb-3 row">
          <label htmlFor="inputUsername" className="col-sm-2 col-form-label">
            Username
          </label>
          <div className="col-sm-10">
            <input
              name="username"
              type="text"
              className="form-control"
              id="inputUsername"
            />
          </div>
        </div>
        <div className="mb-3 row">
          <label htmlFor="inputPassword" className="col-sm-2 col-form-label">
            Password
          </label>
          <div className="col-sm-10">
            <input
              name="password"
              type="password"
              className="form-control"
              id="inputPassword"
            />
          </div>
        </div>

        <Button type="submit">Sign in with {provider.name}</Button>
      </form>
    </div>
  )
}
