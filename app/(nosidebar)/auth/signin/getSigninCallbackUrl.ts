import { ClientSafeProvider } from 'next-auth/react'
import { ReadonlyURLSearchParams } from 'next/navigation'

export const getSigninCallbackUrl = (
  provider: ClientSafeProvider,
  searchParams: ReadonlyURLSearchParams
) => {
  const redirectBack = searchParams.get('redirectBack')
  if (!redirectBack) return provider.callbackUrl

  const url = new URL(provider.callbackUrl)
  url.searchParams.append('callbackUrl', redirectBack)
  return url.toString()
}
