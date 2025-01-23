import { Mastodon } from '@llun/activities.schema'

import { Account } from '../models/account'
import { Actor } from '../models/actor'
import { getISOTimeUTC } from '../utils/getISOTimeUTC'
import { SqlStorage } from './sql'
import { ActorSettings, SQLActor } from './types/sql'

export class PGStorage extends SqlStorage {
  async destroy() {
    await this.database.destroy()
  }
}
