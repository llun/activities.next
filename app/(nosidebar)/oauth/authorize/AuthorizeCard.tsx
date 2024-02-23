'use client'

import intersection from 'lodash/intersection'
import { useRouter } from 'next/navigation'
import { FC } from 'react'

import { Button } from '@/lib/components/Button'
import { Client } from '@/lib/models/oauth2/client'
import { UsableScopes } from '@/lib/storage/types/oauth'

import { SearchParams } from './types'

interface Props {
  client: Client
  searchParams: SearchParams
}

export const AuthorizeCard: FC<Props> = ({ searchParams, client }) => {
  const requestedScopes = searchParams.scope.split(' ')
  const router = useRouter()
  const availabledScopes = intersection(UsableScopes, requestedScopes)
  return (
    <form className="card" action="/api/oauth/authorize" method="post">
      <div className="card-body">
        <h5 className="card-title mb-2">Authorization required</h5>
        <p className="card-text mb-2">
          <strong>{client.name}</strong> would like permission to access your
          account. It is a third-party application.{' '}
          <strong>
            If you do not trust it, then you should not authorize it.
          </strong>
        </p>
        <h6 className="mb-2 text-body-secondary">Review permissions</h6>
        <div className="mb-2">
          {availabledScopes.map((scope) => (
            <div key={scope} className="form-check">
              <input
                className="form-check-input"
                name="scope"
                type="checkbox"
                value={scope}
                id={`scope-${scope}`}
                defaultChecked
              />
              <label className="form-check-label" htmlFor={`scope-${scope}`}>
                {scope}
              </label>
            </div>
          ))}
        </div>
        <div className="row gap-2 px-2">
          <input
            type="hidden"
            name="client_id"
            value={searchParams.client_id}
          />
          <input
            type="hidden"
            name="redirect_uri"
            value={searchParams.redirect_uri}
          />
          <input
            type="hidden"
            name="response_type"
            value={searchParams.response_type}
          />

          <Button className="col" type="submit">
            Approve
          </Button>
          <Button
            className="col"
            variant="danger"
            onClick={() => {
              router.push(client.website ?? '/')
            }}
          >
            Deny
          </Button>
        </div>
      </div>
    </form>
  )
}
