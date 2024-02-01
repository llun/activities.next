import { memoize } from 'lodash'
import Provider from 'oidc-provider'

import { getConfig } from '@/lib/config'

export const getProvider = memoize(() => {
  const { host } = getConfig()
  const provider = new Provider(`https://${host}`)
  return provider
})
