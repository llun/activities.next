'use client'

import { FC } from 'react'

import { OAuth2Application } from '@/lib/models/oauth2/application'

import { SearchParams } from './types'

interface Props {
  application: OAuth2Application
  searchParams: SearchParams
}

export const AuthorizeCard: FC<Props> = ({ searchParams, application }) => {
  const requestedScopes = searchParams.scope.split(' ')
  return (
    <div className="card">
      <div className="card-body">
        <h5 className="card-title mb-2">Authorization required</h5>
        <p className="card-text mb-2">
          <strong>{application.clientName}</strong> would like permission to
          access your account. It is a third-party application.{' '}
          <strong>
            If you do not trust it, then you should not authorize it.
          </strong>
        </p>
        <h6 className="mb-2 text-body-secondary">Review permissions</h6>
        <ul>
          {requestedScopes.map((scope) => (
            <li key={scope}>
              <input type="checkbox" />
              {scope}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
