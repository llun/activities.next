import { AuthorizationServer, DateInterval } from '@jmondi/oauth2-server'
import { memoize } from 'lodash'

import { getStorage } from '@/lib/storage'

import { AuthCodeRepository } from './authCodeRepository'
import { ClientRepository } from './clientRepository'
import { ScopeRepository } from './scopeRepository'
import { TokenRepository } from './tokenRepository'
import { UserRepository } from './userRepository'
import { getConfig } from '@/lib/config'

export const getOAuth2Server = memoize(async () => {
  const storage = await getStorage()
  if (!storage) throw new Error('Fail to get storage')

  const authorizationServer = new AuthorizationServer(
    new ClientRepository(storage),
    new TokenRepository(storage),
    new ScopeRepository(),
    getConfig().secretPhase
  )

  const userRepository = new UserRepository(storage)
  const authCodeRepository = new AuthCodeRepository(storage)
  authorizationServer.enableGrantTypes(
    ['refresh_token', new DateInterval('30d')],
    { grant: 'authorization_code', authCodeRepository, userRepository }
  )
  return authorizationServer
})
