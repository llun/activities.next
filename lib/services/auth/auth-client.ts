'use client'

import { sentinelClient } from '@better-auth/infra/client'
import { oauthProviderClient } from '@better-auth/oauth-provider/client'
import { passkeyClient } from '@better-auth/passkey/client'
import { twoFactorClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient({
  plugins: [
    oauthProviderClient(),
    sentinelClient(),
    passkeyClient(),
    twoFactorClient()
  ]
})
