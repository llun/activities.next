import { Provider } from '@/lib/types/nextauth'

export const getSigninCallbackUrl = (
  provider: Provider,
  searchParams: URLSearchParams
) => {
  const redirectBack = searchParams.get('redirectBack')
  if (!redirectBack) return provider.callbackUrl

  const url = new URL(provider.callbackUrl)
  url.searchParams.append('callbackUrl', redirectBack)
  return url.toString()
}
