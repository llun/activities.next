import { Mastodon } from '@llun/activities.schema'
import pg from 'pg'

import { getISOTimeUTC } from '../utils/getISOTimeUTC'
import { SqlStorage } from './sql'
import { ActorSettings } from './types/sql'

export class PGStorage extends SqlStorage {
  async destroy() {
    await this.database.destroy()
  }

  protected async getMastodonActor(actorId: string) {
    const sqlActor = await this.database('actors').where('id', actorId).first()
    if (!sqlActor) return null

    const [lastStatusCreatedAt, totalStatus, totalFollowers, totalFollowing] =
      await this.database.transaction(async (trx) =>
        Promise.all([
          trx('statuses')
            .where('actorId', actorId)
            .orderBy('createdAt', 'desc')
            .select('createdAt')
            .first<{ createdAt: number }>(),
          trx('statuses')
            .where('actorId', actorId)
            .count<{ count: string }>('* as count')
            .first(),
          trx('follows')
            .where('targetActorId', actorId)
            .andWhere('status', 'Accepted')
            .count<{ count: string }>('* as count')
            .first(),
          trx('follows')
            .where('actorId', actorId)
            .andWhere('status', 'Accepted')
            .count<{ count: string }>('* as count')
            .first()
        ])
      )

    const settings = sqlActor.settings as ActorSettings
    return Mastodon.Account.parse({
      id: sqlActor.id,
      username: sqlActor.username,
      acct: `${sqlActor.username}@${sqlActor.domain}`,
      url: sqlActor.id,
      display_name: sqlActor.name ?? '',
      note: sqlActor.summary ?? '',

      avatar: settings.iconUrl ?? '',
      avatar_static: settings.iconUrl ?? '',
      header: settings.headerImageUrl ?? '',
      header_static: settings.headerImageUrl ?? '',

      fields: [],
      emojis: [],

      locked: false,
      bot: false,
      group: false,
      discoverable: true,
      noindex: false,

      created_at: getISOTimeUTC(sqlActor.createdAt.getTime()),
      last_status_at: lastStatusCreatedAt
        ? getISOTimeUTC(sqlActor.createdAt.getTime())
        : null,

      followers_count: parseInt(totalFollowers?.count ?? '0', 10),
      following_count: parseInt(totalFollowing?.count ?? '0', 10),
      statuses_count: parseInt(totalStatus?.count ?? '0', 10)
    })
  }
}
