'use client'

import { ClientSafeProvider, getCsrfToken } from 'next-auth/react'
import { FC } from 'react'

import { Button } from '@/lib/components/Button'

interface Props {
  provider: ClientSafeProvider
}

export const CredentialForm: FC<Props> = async ({ provider }) => {
  const csrfToken = await getCsrfToken()

  return (
    <div key={provider.name} className="mb-2">
      <form method="post" action={provider.callbackUrl}>
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
