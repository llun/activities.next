import { OAuthUser, OAuthUserRepository } from '@jmondi/oauth2-server'

import { User } from '@/lib/models/oauth2/user'
import { Storage } from '@/lib/storage/types'

export class UserRepository implements OAuthUserRepository {
  storage: Storage

  constructor(storage: Storage) {
    this.storage = storage
  }

  async getUserByCredentials(identifier: string): Promise<OAuthUser> {
    const actor = await this.storage.getActorFromId({ id: identifier })
    if (!actor || !actor.account) throw new Error('Fail to find actor')
    return User.parse({
      id: actor.id,
      actor: actor.data,
      account: actor.account
    })
  }
}
