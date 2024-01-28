import { ClientSafeProvider } from 'next-auth/react'

import { getSigninCallbackUrl } from './getSigninCallbackUrl'

const MOCK_PROVIDER: ClientSafeProvider = {
  id: 'provider',
  name: 'provider',
  signinUrl: 'https://test.llun.dev/auth/signin',
  type: 'credentials',
  callbackUrl: 'https://test.llun.dev/auth/callback'
}

describe('#getSigninCallbackUrl', () => {
  it('returns provider callback url', () => {
    expect(getSigninCallbackUrl(MOCK_PROVIDER, new URLSearchParams())).toEqual(
      'https://test.llun.dev/auth/callback'
    )
  })

  it('returns provider callback url with redirectBack path', () => {
    const url = new URL(MOCK_PROVIDER.callbackUrl)
    url.searchParams.append('callbackUrl', '/somewhere-else')
    expect(
      getSigninCallbackUrl(
        MOCK_PROVIDER,
        new URLSearchParams([['redirectBack', '/somewhere-else']])
      )
    ).toEqual(url.toString())
  })
})
