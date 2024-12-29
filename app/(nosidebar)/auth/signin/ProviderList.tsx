'use client'

import { getProviders } from 'next-auth/react'
import { FC } from 'react'

import { CredentialForm } from './CredentialForm'
import { SigninButton } from './SigninButton'

export const ProviderList: FC = async () => {
  const providers = await getProviders()
  return (
    <>
      {Object.values(providers ?? []).map((provider) => {
        if (provider.id === 'credentials') {
          return <CredentialForm key={provider.id} provider={provider} />
        }

        return (
          <SigninButton
            key={provider.id}
            providerId={provider.id}
            providerName={provider.name}
          />
        )
      })}
    </>
  )
}
