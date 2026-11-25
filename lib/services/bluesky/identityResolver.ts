import { createIdentityResolver } from '@atproto-labs/identity-resolver'
import { AtprotoHandleResolverNode } from '@atproto/oauth-client-node'

import { blueskyFetch } from './fetch'

export const createBlueskyIdentityResolver = () =>
  createIdentityResolver({
    fetch: blueskyFetch,
    handleResolver: new AtprotoHandleResolverNode({ fetch: blueskyFetch })
  })
