import { Mastodon } from '@llun/activities.schema'
import knex, { Knex } from 'knex'

import { AccountSQLDatabaseMixin } from '@/lib/database/sql/account'
import { ActorSQLDatabaseMixin } from '@/lib/database/sql/actor'
import { FollowerSQLDatabaseMixin } from '@/lib/database/sql/follow'
import { LikeSQLDatabaseMixin } from '@/lib/database/sql/like'
import { MediaSQLDatabaseMixin } from '@/lib/database/sql/media'
import { OAuthDatabaseMixin } from '@/lib/database/sql/oauth'
import { StatusSQLDatabaseMixin } from '@/lib/database/sql/status'
import { TimelineSQLDatabaseMixin } from '@/lib/database/sql/timeline'
import { Database } from '@/lib/database/types'
import { ActorSettings, SQLAccount, SQLActor } from '@/lib/database/types/sql'
import { Account } from '@/lib/models/account'
import { Actor } from '@/lib/models/actor'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

export const getSQLDatabase = (config: Knex.Config): Database => {
  const database = knex(config)

  const getActor = (
    sqlActor: SQLActor,
    followingCount: number,
    followersCount: number,
    statusCount: number,
    lastStatusAt: number,
    sqlAccount?: SQLAccount
  ) => {
    const settings =
      typeof sqlActor.settings === 'string'
        ? (JSON.parse(sqlActor.settings || '{}') as ActorSettings)
        : sqlActor.settings

    const account = sqlAccount
      ? {
          account: Account.parse({
            ...sqlAccount,
            createdAt:
              typeof sqlAccount.createdAt === 'number'
                ? sqlAccount.createdAt
                : sqlAccount.createdAt.getTime(),
            updatedAt:
              typeof sqlAccount.updatedAt === 'number'
                ? sqlAccount.updatedAt
                : sqlAccount.updatedAt.getTime(),
            ...{
              verifiedAt: sqlAccount.verifiedAt
                ? typeof sqlAccount.verifiedAt === 'number'
                  ? sqlAccount.verifiedAt
                  : sqlAccount.verifiedAt.getTime()
                : null
            }
          })
        }
      : null
    return new Actor({
      id: sqlActor.id,
      username: sqlActor.username,
      domain: sqlActor.domain,
      ...(sqlActor.name ? { name: sqlActor.name } : null),
      ...(sqlActor.summary ? { summary: sqlActor.summary } : null),
      ...(settings.iconUrl ? { iconUrl: settings.iconUrl } : null),
      ...(settings.headerImageUrl
        ? { headerImageUrl: settings.headerImageUrl }
        : null),
      ...(settings.appleSharedAlbumToken
        ? { appleSharedAlbumToken: settings.appleSharedAlbumToken }
        : null),
      followersUrl: settings.followersUrl,
      inboxUrl: settings.inboxUrl,
      sharedInboxUrl: settings.sharedInboxUrl,
      publicKey: sqlActor.publicKey,
      ...(sqlActor.privateKey ? { privateKey: sqlActor.privateKey } : null),
      ...account,

      followingCount,
      followersCount,

      statusCount,
      lastStatusAt,

      createdAt:
        typeof sqlActor.createdAt === 'number'
          ? sqlActor.createdAt
          : sqlActor.createdAt.getTime(),
      updatedAt:
        typeof sqlActor.updatedAt === 'number'
          ? sqlActor.updatedAt
          : sqlActor.updatedAt.getTime()
    })
  }

  const getMastodonActor = async (actorId: string) => {
    const sqlActor = await database<SQLActor>('actors')
      .where('id', actorId)
      .first()
    if (!sqlActor) return null

    const [lastStatus, totalStatus, totalFollowers, totalFollowing] =
      await database.transaction(async (trx) =>
        Promise.all([
          trx('statuses')
            .where('actorId', actorId)
            .orderBy('createdAt', 'desc')
            .select('createdAt')
            .first<{ createdAt: number | Date }>(),
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

    const settings =
      typeof sqlActor.settings === 'string'
        ? (JSON.parse(sqlActor.settings || '{}') as ActorSettings)
        : sqlActor.settings
    const lastStatusCreatedAt = lastStatus?.createdAt ? lastStatus.createdAt : 0
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

      created_at: getISOTimeUTC(
        typeof sqlActor.createdAt === 'number'
          ? sqlActor.createdAt
          : sqlActor.createdAt.getTime()
      ),
      last_status_at: lastStatusCreatedAt
        ? getISOTimeUTC(
            typeof lastStatusCreatedAt === 'number'
              ? lastStatusCreatedAt
              : lastStatusCreatedAt.getTime()
          )
        : null,

      followers_count: parseInt(totalFollowers?.count ?? '0', 10),
      following_count: parseInt(totalFollowing?.count ?? '0', 10),
      statuses_count: parseInt(totalStatus?.count ?? '0', 10)
    })
  }

  const accountDatabase = AccountSQLDatabaseMixin(database)
  const actorDatabase = ActorSQLDatabaseMixin(
    database,
    getActor,
    getMastodonActor
  )
  const followerDatabase = FollowerSQLDatabaseMixin(
    database,
    actorDatabase,
    getActor
  )
  const likeDatabase = LikeSQLDatabaseMixin(database)
  const mediaDatabase = MediaSQLDatabaseMixin(database)
  const oauthDatabase = OAuthDatabaseMixin(
    database,
    accountDatabase,
    actorDatabase
  )
  const statusDatabase = StatusSQLDatabaseMixin(
    database,
    actorDatabase,
    mediaDatabase
  )
  const timelineDatabase = TimelineSQLDatabaseMixin(database, statusDatabase)

  return {
    async migrate() {
      await database.migrate.latest()
    },

    async destroy() {
      await database.destroy()
    },

    ...accountDatabase,
    ...actorDatabase,
    ...followerDatabase,
    ...likeDatabase,
    ...mediaDatabase,
    ...oauthDatabase,
    ...statusDatabase,
    ...timelineDatabase
  }
}
