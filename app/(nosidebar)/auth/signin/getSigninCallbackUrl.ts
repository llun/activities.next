import { ClientSafeProvider } from 'next-auth/react'

export const getSigninCallbackUrl = (
  provider: ClientSafeProvider,
  searchParams: URLSearchParams
) => {
  const redirectBack = searchParams.get('redirectBack')
  if (!redirectBack) return provider.callbackUrl

  const url = new URL(provider.callbackUrl)
  url.searchParams.append('redirectBack', redirectBack)
  return url.toString()
}
