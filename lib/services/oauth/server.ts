import { AuthorizationServer, DateInterval } from '@jmondi/oauth2-server'
import { memoize } from 'lodash'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'

import { AuthCodeRepository } from './authCodeRepository'
import { ClientRepository } from './clientRepository'
import { ScopeRepository } from './scopeRepository'
import { TokenRepository } from './tokenRepository'
import { UserRepository } from './userRepository'

export const getOAuth2Server = memoize(async () => {
  const database = getDatabase()
  if (!database) throw new Error('Fail to get database')

  const authorizationServer = new AuthorizationServer(
    new ClientRepository(database),
    new TokenRepository(database),
    new ScopeRepository(),
    getConfig().secretPhase,
    {
      requiresPKCE: false
    }
  )

  const userRepository = new UserRepository(database)
  const authCodeRepository = new AuthCodeRepository(database)
  authorizationServer.enableGrantTypes(
    ['client_credentials', new DateInterval('30d')],
    ['refresh_token', new DateInterval('30d')],
    [
      { grant: 'authorization_code', authCodeRepository, userRepository },
      new DateInterval('30d')
    ]
  )
  return authorizationServer
})
