import { OAuthUser, OAuthUserRepository } from '@jmondi/oauth2-server'

import { Database } from '@/lib/database/types'
import { User } from '@/lib/models/oauth2/user'

export class UserRepository implements OAuthUserRepository {
  database: Database

  constructor(database: Database) {
    this.database = database
  }

  async getUserByCredentials(identifier: string): Promise<OAuthUser> {
    const actor = await this.database.getActorFromId({ id: identifier })
    if (!actor || !actor.account) throw new Error('Fail to find actor')
    return User.parse({
      id: actor.id,
      actor,
      account: actor.account
    })
  }
}
