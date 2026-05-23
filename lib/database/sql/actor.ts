import { Knex } from 'knex'

import { getConfig } from '@/lib/config'
import {
  deleteActorSearchDocument,
  indexActorSearchDocument,
  indexHashtagSearchDocuments
} from '@/lib/database/sql/search'
import {
  CounterKey,
  decreaseCounterValue,
  deleteCounterValue,
  getCounterValue,
  getCounterValues,
  increaseCounterValue,
  parseCounterValue,
  setCounterValue
} from '@/lib/database/sql/utils/counter'
import { getCompatibleJSON } from '@/lib/database/sql/utils/getCompatibleJSON'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  FEDERATION_SIGNING_ACTOR_TYPE,
  FEDERATION_SIGNING_ACTOR_USERNAME,
  getFederationSigningActorId,
  getFederationSigningActorUsername,
  isFederationSigningActor,
  isFederationSigningActorUsername
} from '@/lib/services/federation/instanceActor'
import { Mastodon } from '@/lib/types/activitypub'
import {
  ActorDatabase,
  CancelActorDeletionParams,
  CreateActorParams,
  DeleteActorDataParams,
  DeleteActorParams,
  GetActorFollowersCountParams,
  GetActorFollowingCountParams,
  GetActorFromEmailParams,
  GetActorFromIdParams,
  GetActorFromUsernameParams,
  GetActorSettingsParams,
  GetActorsFromIdsParams,
  GetActorsScheduledForDeletionParams,
  IsCurrentActorFollowingParams,
  IsInternalActorParams,
  ScheduleActorDeletionParams,
  StartActorDeletionParams,
  UpdateActorParams
} from '@/lib/types/database/operations'
import { ActorSettings, SQLAccount, SQLActor } from '@/lib/types/database/rows'
import { Account } from '@/lib/types/domain/account'
import { Actor, ActorType } from '@/lib/types/domain/actor'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { generateKeyPair } from '@/lib/utils/signature'
import { urlToId } from '@/lib/utils/urlToId'

export interface SQLActorDatabase extends ActorDatabase {
  getActor: (
    sqlActor: SQLActor,
    followingCount: number,
    followersCount: number,
    statusCount: number,
    lastStatusAt: number,
    sqlAccount?: SQLAccount
  ) => Actor
  getMastodonActor: (actorId: string) => Promise<Mastodon.Account | null>
  getMastodonActors: (actorIds: string[]) => Promise<Mastodon.Account[]>
}

const SQLITE_MAX_BINDINGS = 999

const getClientName = (database: Knex | Knex.Transaction) =>
  String(database.client.config.client)

const getWhereInBatchSize = (
  database: Knex | Knex.Transaction,
  reservedBindings = 0
) => {
  if (!getClientName(database).includes('sqlite'))
    return Number.POSITIVE_INFINITY
  return Math.max(1, SQLITE_MAX_BINDINGS - reservedBindings)
}

const chunkArray = <T>(items: T[], size: number) => {
  const chunkSize = Number.isFinite(size) ? size : Math.max(items.length, 1)
  const chunks: T[][] = []
  for (let start = 0; start < items.length; start += chunkSize) {
    chunks.push(items.slice(start, start + chunkSize))
  }
  return chunks
}

const selectHashtagTagsByStatusIds = async (
  trx: Knex.Transaction,
  statusIds: string[]
) => {
  const rows: { name: string; nameNormalized: string | null }[] = []
  for (const statusIdChunk of chunkArray(
    statusIds,
    getWhereInBatchSize(trx, 1)
  )) {
    rows.push(
      ...(await trx('tags')
        .whereIn('statusId', statusIdChunk)
        .where('type', 'hashtag')
        .select<
          { name: string; nameNormalized: string | null }[]
        >('name', 'nameNormalized'))
    )
  }
  return rows
}

const selectPollChoiceIdsByStatusIds = async (
  trx: Knex.Transaction,
  statusIds: string[]
) => {
  const rows: { choiceId: string }[] = []
  for (const statusIdChunk of chunkArray(statusIds, getWhereInBatchSize(trx))) {
    rows.push(
      ...(await trx('poll_choices')
        .whereIn('statusId', statusIdChunk)
        .select('choiceId'))
    )
  }
  return rows
}

const deleteRowsByColumnChunks = async (
  trx: Knex.Transaction,
  tableName: string,
  columnName: string,
  values: string[]
) => {
  for (const valueChunk of chunkArray(values, getWhereInBatchSize(trx))) {
    await trx(tableName).whereIn(columnName, valueChunk).delete()
  }
}

const getActorCounterSummary = async (
  trx: Knex.Transaction,
  actorId: string
): Promise<{
  followersCount: number
  followingCount: number
  statusCount: number
}> => {
  const counters = await getCounterValues(trx, [
    CounterKey.totalFollowers(actorId),
    CounterKey.totalFollowing(actorId),
    CounterKey.totalStatus(actorId)
  ])

  return {
    followersCount: counters[CounterKey.totalFollowers(actorId)] ?? 0,
    followingCount: counters[CounterKey.totalFollowing(actorId)] ?? 0,
    statusCount: counters[CounterKey.totalStatus(actorId)] ?? 0
  }
}

const insertActorWithSearchIndex = async (
  database: Knex,
  {
    actorId,
    type = 'Person',
    username,
    domain,
    name,
    summary,
    iconUrl,
    headerImageUrl,
    followersUrl,
    inboxUrl,
    sharedInboxUrl,
    publicKey,
    privateKey,
    createdAt
  }: CreateActorParams
) => {
  const currentTime = new Date()
  const settings: ActorSettings = {
    iconUrl,
    headerImageUrl,
    followersUrl,
    inboxUrl,
    sharedInboxUrl
  }
  const actor = {
    id: actorId,
    type,
    username,
    domain,
    name,
    summary,
    accountId: null,
    settings: JSON.stringify(settings),
    publicKey,
    privateKey,
    deletionStatus: null,
    deletionScheduledAt: null,
    createdAt: new Date(createdAt),
    updatedAt: currentTime
  }

  await database.transaction(async (trx) => {
    await trx('actors').insert(actor)
    await indexActorSearchDocument(trx, { id: actorId, actor })
  })
}

const parseStatusContent = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: any
): string | Record<string, unknown> | null => {
  if (!content) return null
  if (typeof content === 'string') {
    try {
      return getCompatibleJSON(content)
    } catch {
      return content
    }
  }
  return content
}

const getStatusUrlHash = (url: string): string => getHashFromString(url)

const getConfiguredActorDomain = () => {
  const host = getConfig().host
  return host.includes('://') ? new URL(host).host : host
}

const getFederationSigningActorSettings = (
  actorId: string,
  domain: string
) => ({
  followersUrl: `${actorId}/followers`,
  inboxUrl: `${actorId}/inbox`,
  sharedInboxUrl: `https://${domain}/inbox`
})

const isValidFederationSigningSQLActor = (
  sqlActor: SQLActor | undefined,
  domain: string
): sqlActor is SQLActor =>
  Boolean(
    sqlActor &&
    sqlActor.type === FEDERATION_SIGNING_ACTOR_TYPE &&
    sqlActor.domain === domain &&
    sqlActor.accountId == null &&
    sqlActor.privateKey &&
    !sqlActor.deletionStatus &&
    isFederationSigningActorUsername(sqlActor.username)
  )

const FEDERATION_SIGNING_ACTOR_USERNAME_LIKE_PATTERN = `${FEDERATION_SIGNING_ACTOR_USERNAME.replace(/[\\%_]/g, '\\$&')}%`

const federationSigningActorCreationLocks = new Map<
  string,
  Promise<Actor | null>
>()
// Process-local only; cross-process races still rely on the actor id unique
// constraint plus insert recovery below.

const isMastodonBotActorType = (type: SQLActor['type']) =>
  type === 'Service' || type === 'Application' || type === 'Organization'

const getLastStatusCreatedAtByActorId = async (
  database: Knex,
  actorIds: string[]
) => {
  if (actorIds.length === 0) return new Map<string, number | Date>()

  const rows = await database('statuses')
    .whereIn('actorId', actorIds)
    .groupBy('actorId')
    .select<{ actorId: string; createdAt: number | Date }[]>(
      'actorId',
      database.raw('MAX(??) as ??', ['createdAt', 'createdAt'])
    )

  return new Map(rows.map((row) => [row.actorId, row.createdAt]))
}

const getActorCounterSummaries = async (database: Knex, actorIds: string[]) => {
  const counterValues = await getCounterValues(
    database,
    actorIds.flatMap((actorId) => [
      CounterKey.totalFollowers(actorId),
      CounterKey.totalFollowing(actorId),
      CounterKey.totalStatus(actorId)
    ])
  )

  return new Map(
    actorIds.map((actorId) => [
      actorId,
      {
        followersCount: counterValues[CounterKey.totalFollowers(actorId)] ?? 0,
        followingCount: counterValues[CounterKey.totalFollowing(actorId)] ?? 0,
        statusCount: counterValues[CounterKey.totalStatus(actorId)] ?? 0
      }
    ])
  )
}

const getMastodonAccountFromSQLActor = ({
  sqlActor,
  counters,
  lastStatusCreatedAt
}: {
  sqlActor: SQLActor
  counters: {
    followersCount: number
    followingCount: number
    statusCount: number
  }
  lastStatusCreatedAt: number | Date | undefined
}) => {
  const settings = getCompatibleJSON(sqlActor.settings)
  const isLocalHeadlessSigner = isValidFederationSigningSQLActor(
    sqlActor,
    getConfiguredActorDomain()
  )

  return Mastodon.Account.parse({
    id: urlToId(sqlActor.id),
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

    locked: settings.manuallyApprovesFollowers ?? true,
    bot: isMastodonBotActorType(sqlActor.type),
    group: sqlActor.type === 'Group',
    discoverable: !isLocalHeadlessSigner,
    noindex: isLocalHeadlessSigner,

    source: {
      note: '',
      fields: [],
      privacy: 'public',
      sensitive: false,
      language: 'en',
      follow_requests_count: 0
    },

    created_at: getISOTimeUTC(getCompatibleTime(sqlActor.createdAt)),
    last_status_at: lastStatusCreatedAt
      ? getISOTimeUTC(getCompatibleTime(lastStatusCreatedAt), true)
      : null,

    followers_count: counters.followersCount,
    following_count: counters.followingCount,
    statuses_count: counters.statusCount
  })
}

export const ActorSQLDatabaseMixin = (database: Knex): SQLActorDatabase => ({
  async createActor(params: CreateActorParams) {
    await insertActorWithSearchIndex(database, params)
    const { actorId } = params
    return this.getActorFromId({ id: actorId })
  },

  async createMastodonActor(
    params: CreateActorParams
  ): Promise<Mastodon.Account | null> {
    await insertActorWithSearchIndex(database, params)
    const { actorId } = params
    return this.getMastodonActor(actorId)
  },

  async getActorFromEmail({ email }: GetActorFromEmailParams) {
    const persistedActor = await database('actors')
      .select<SQLActor>('actors.*')
      .leftJoin('accounts', 'actors.accountId', 'accounts.id')
      .where('accounts.email', email)
      .first()
    if (!persistedActor) return null

    const [account, counters, lastStatus] = await database.transaction(
      async (trx) => {
        return Promise.all([
          trx<Account>('accounts')
            .where('id', persistedActor.accountId)
            .first(),
          getActorCounterSummary(trx, persistedActor.id),
          trx('statuses')
            .where('actorId', persistedActor.id)
            .orderBy('createdAt', 'desc')
            .first<{ createdAt: number | Date }>('createdAt')
        ])
      }
    )

    const lastStatusCreatedAt = lastStatus?.createdAt ? lastStatus.createdAt : 0
    return this.getActor(
      persistedActor,
      counters.followingCount,
      counters.followersCount,
      counters.statusCount,
      getCompatibleTime(lastStatusCreatedAt),
      account
    )
  },

  async getMastodonActorFromEmail({ email }: GetActorFromEmailParams) {
    const result = await database('actors')
      .select('actors.id')
      .leftJoin('accounts', 'actors.accountId', 'accounts.id')
      .where('accounts.email', email)
      .first<{ id: string }>()
    if (!result) return null
    return this.getMastodonActor(result.id)
  },

  async isCurrentActorFollowing({
    currentActorId,
    followingActorId
  }: IsCurrentActorFollowingParams) {
    const result = await database('follows')
      .where('actorId', currentActorId)
      .andWhere('targetActorId', followingActorId)
      .andWhere('status', 'Accepted')
      .count<{ count: string }>('id as count')
      .first()
    return parseInt(result?.count ?? '0', 10) > 0
  },

  async getActorFromUsername({ username, domain }: GetActorFromUsernameParams) {
    const persistedActor = await database<SQLActor>('actors')
      .where('username', username)
      .andWhere('domain', domain)
      .first()
    if (!persistedActor) return null

    const [account, counters, lastStatus] = await database.transaction(
      async (trx) => {
        return Promise.all([
          trx<Account>('accounts')
            .where('id', persistedActor.accountId)
            .first(),
          getActorCounterSummary(trx, persistedActor.id),
          trx('statuses')
            .where('actorId', persistedActor.id)
            .orderBy('createdAt', 'desc')
            .first<{ createdAt: number | Date }>('createdAt')
        ])
      }
    )

    const lastStatusCreatedAt = lastStatus?.createdAt ? lastStatus.createdAt : 0
    return this.getActor(
      persistedActor,
      counters.followingCount,
      counters.followersCount,
      counters.statusCount,
      getCompatibleTime(lastStatusCreatedAt),
      account
    )
  },

  async getFederationSigningActor() {
    const domain = getConfiguredActorDomain()
    const actorId = getFederationSigningActorId(domain)
    const getActorFromRow = (sqlActor: SQLActor | undefined) => {
      if (!isValidFederationSigningSQLActor(sqlActor, domain)) return null

      return this.getActor(sqlActor, 0, 0, 0, 0)
    }
    const getExistingHeadlessActor = async () => {
      const localServiceActors = await database<SQLActor>('actors')
        .where('domain', domain)
        .andWhere('type', FEDERATION_SIGNING_ACTOR_TYPE)
        .whereRaw("?? LIKE ? ESCAPE '\\'", [
          'username',
          FEDERATION_SIGNING_ACTOR_USERNAME_LIKE_PATTERN
        ])
        .whereNull('accountId')
        .whereNotNull('privateKey')
        .where('privateKey', '<>', '')
        .whereNull('deletionStatus')
        .orderBy('createdAt', 'asc')
        .orderBy('id', 'asc')

      for (const sqlActor of localServiceActors) {
        const actor = getActorFromRow(sqlActor)
        if (actor) return actor
      }

      return null
    }

    const pendingActor = federationSigningActorCreationLocks.get(domain)
    if (pendingActor) return pendingActor

    const createSigningActor = async () => {
      const reservedActor = getActorFromRow(
        await database<SQLActor>('actors').where('id', actorId).first()
      )
      if (reservedActor) return reservedActor

      const existingHeadlessActor = await getExistingHeadlessActor()
      if (existingHeadlessActor) return existingHeadlessActor

      const usedUsernames = new Set(
        (
          await database<SQLActor>('actors')
            .where('domain', domain)
            .whereRaw("?? LIKE ? ESCAPE '\\'", [
              'username',
              FEDERATION_SIGNING_ACTOR_USERNAME_LIKE_PATTERN
            ])
            .select('username')
        ).map((actor) => actor.username)
      )
      let username = FEDERATION_SIGNING_ACTOR_USERNAME
      for (let index = 0; usedUsernames.has(username); index += 1) {
        username = getFederationSigningActorUsername(index + 1)
      }
      const signingActorId = getFederationSigningActorId(domain, username)

      const currentTime = new Date()
      const keyPair = await generateKeyPair(getConfig().secretPhase)
      try {
        await database<SQLActor>('actors').insert({
          id: signingActorId,
          type: FEDERATION_SIGNING_ACTOR_TYPE,
          username,
          domain,
          name: 'Instance actor',
          summary: 'Service actor used for ActivityPub federation signing.',
          accountId: null,
          settings: JSON.stringify(
            getFederationSigningActorSettings(signingActorId, domain)
          ),
          publicKey: keyPair.publicKey,
          privateKey: keyPair.privateKey,
          createdAt: currentTime,
          updatedAt: currentTime
        })
      } catch (error) {
        const actor = await getExistingHeadlessActor()
        if (actor) return actor
        throw error
      }

      const sqlActor = await database<SQLActor>('actors')
        .where('id', signingActorId)
        .first()
      return getActorFromRow(sqlActor)
    }

    const creatingActor = createSigningActor()
    federationSigningActorCreationLocks.set(domain, creatingActor)
    try {
      return await creatingActor
    } finally {
      if (federationSigningActorCreationLocks.get(domain) === creatingActor) {
        federationSigningActorCreationLocks.delete(domain)
      }
    }
  },

  async getMastodonActorFromUsername({
    username,
    domain
  }: GetActorFromUsernameParams) {
    const result = await database<SQLActor>('actors')
      .where('username', username)
      .andWhere('domain', domain)
      .select('id')
      .first<{ id: string }>()
    if (!result) return null

    return this.getMastodonActor(result.id)
  },

  async getActorFromId({ id }: GetActorFromIdParams) {
    const persistedActor = await database<SQLActor>('actors')
      .where('id', id)
      .first()
    if (!persistedActor) return null

    if (!persistedActor.accountId) {
      const [counters, lastStatus] = await database.transaction(async (trx) => {
        return Promise.all([
          getActorCounterSummary(trx, persistedActor.id),
          trx('statuses')
            .where('actorId', persistedActor.id)
            .orderBy('createdAt', 'desc')
            .first<{ createdAt: number | Date }>('createdAt')
        ])
      })

      const lastStatusCreatedAt = lastStatus?.createdAt
        ? lastStatus.createdAt
        : 0
      return this.getActor(
        persistedActor,
        counters.followingCount,
        counters.followersCount,
        counters.statusCount,
        getCompatibleTime(lastStatusCreatedAt)
      )
    }

    const [account, counters, lastStatus] = await database.transaction(
      async (trx) => {
        return Promise.all([
          trx<Account>('accounts')
            .where('id', persistedActor.accountId)
            .first(),
          getActorCounterSummary(trx, persistedActor.id),
          trx('statuses')
            .where('actorId', persistedActor.id)
            .orderBy('createdAt', 'desc')
            .first<{ createdAt: number | Date }>('createdAt')
        ])
      }
    )

    const lastStatusCreatedAt = lastStatus?.createdAt ? lastStatus.createdAt : 0
    return this.getActor(
      persistedActor,
      counters.followingCount,
      counters.followersCount,
      counters.statusCount,
      getCompatibleTime(lastStatusCreatedAt),
      account
    )
  },

  async getActorsFromIds({ ids }: GetActorsFromIdsParams) {
    const actorIds = [...new Set(ids)]
    if (actorIds.length === 0) return []

    const persistedActors = await database<SQLActor>('actors').whereIn(
      'id',
      actorIds
    )
    const actorById = new Map(persistedActors.map((actor) => [actor.id, actor]))
    const accountIds = [
      ...new Set(
        persistedActors
          .map((actor) => actor.accountId)
          .filter((accountId): accountId is string => Boolean(accountId))
      )
    ]
    const [accounts, countersByActorId, lastStatusCreatedAtByActorId] =
      await Promise.all([
        accountIds.length > 0
          ? database<SQLAccount>('accounts').whereIn('id', accountIds)
          : [],
        getActorCounterSummaries(database, actorIds),
        getLastStatusCreatedAtByActorId(database, actorIds)
      ])
    const accountById = new Map(
      accounts.map((account) => [account.id, account])
    )

    return actorIds
      .map((actorId) => {
        const actor = actorById.get(actorId)
        if (!actor) return null

        const counters = countersByActorId.get(actorId) ?? {
          followersCount: 0,
          followingCount: 0,
          statusCount: 0
        }
        const lastStatusCreatedAt = lastStatusCreatedAtByActorId.get(actorId)

        return this.getActor(
          actor,
          counters.followingCount,
          counters.followersCount,
          counters.statusCount,
          getCompatibleTime(lastStatusCreatedAt ?? 0),
          actor.accountId ? accountById.get(actor.accountId) : undefined
        )
      })
      .filter((actor): actor is Actor => actor !== null)
  },

  async getMastodonActorFromId({ id }: GetActorFromIdParams) {
    return this.getMastodonActor(id)
  },

  async getMastodonActorsFromIds({ ids }: GetActorsFromIdsParams) {
    return this.getMastodonActors(ids)
  },

  getActor(
    sqlActor: SQLActor,
    followingCount: number,
    followersCount: number,
    statusCount: number,
    lastStatusAt: number,
    sqlAccount?: SQLAccount
  ): Actor {
    const settings = getCompatibleJSON(sqlActor.settings)
    const account = sqlAccount
      ? {
          account: Account.parse({
            ...sqlAccount,
            createdAt: getCompatibleTime(sqlAccount.createdAt),
            updatedAt: getCompatibleTime(sqlAccount.updatedAt),
            ...{
              verifiedAt: sqlAccount.verifiedAt
                ? getCompatibleTime(sqlAccount.verifiedAt)
                : null
            },
            ...{
              emailVerifiedAt: sqlAccount.emailVerifiedAt
                ? getCompatibleTime(sqlAccount.emailVerifiedAt)
                : null
            },
            ...{
              emailChangeCodeExpiresAt: sqlAccount.emailChangeCodeExpiresAt
                ? getCompatibleTime(sqlAccount.emailChangeCodeExpiresAt)
                : null
            },
            passwordResetCodeExpiresAt: sqlAccount.passwordResetCodeExpiresAt
              ? getCompatibleTime(sqlAccount.passwordResetCodeExpiresAt)
              : null,
            twoFactorEnabled:
              sqlAccount.twoFactorEnabled != null
                ? Boolean(sqlAccount.twoFactorEnabled)
                : false
          })
        }
      : null
    return Actor.parse({
      id: sqlActor.id,
      type: ActorType.catch(ActorType.enum.Person).parse(sqlActor.type),
      username: sqlActor.username,
      domain: sqlActor.domain,
      ...(sqlActor.name ? { name: sqlActor.name } : null),
      ...(sqlActor.summary ? { summary: sqlActor.summary } : null),
      ...(settings.iconUrl ? { iconUrl: settings.iconUrl } : null),
      ...(settings.headerImageUrl
        ? { headerImageUrl: settings.headerImageUrl }
        : null),
      manuallyApprovesFollowers: settings.manuallyApprovesFollowers ?? true,
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

      createdAt: getCompatibleTime(sqlActor.createdAt),
      updatedAt: getCompatibleTime(sqlActor.updatedAt),
      deletionStatus: sqlActor.deletionStatus ?? null,
      deletionScheduledAt: sqlActor.deletionScheduledAt
        ? getCompatibleTime(sqlActor.deletionScheduledAt)
        : null
    })
  },

  async getMastodonActor(actorId: string) {
    const actors = await this.getMastodonActors([actorId])
    return actors[0] ?? null
  },

  async getMastodonActors(actorIds: string[]) {
    const uniqueActorIds = Array.from(new Set(actorIds))
    if (uniqueActorIds.length === 0) return []

    const sqlActors = await database<SQLActor>('actors').whereIn(
      'id',
      uniqueActorIds
    )
    if (sqlActors.length === 0) return []

    const sqlActorById = new Map(sqlActors.map((actor) => [actor.id, actor]))
    const existingActorIds = sqlActors.map((actor) => actor.id)
    const [countersByActorId, lastStatusCreatedAtByActorId] = await Promise.all(
      [
        getActorCounterSummaries(database, existingActorIds),
        getLastStatusCreatedAtByActorId(database, existingActorIds)
      ]
    )

    return actorIds.flatMap((id) => {
      const sqlActor = sqlActorById.get(id)
      if (!sqlActor) return []

      return getMastodonAccountFromSQLActor({
        sqlActor,
        counters: countersByActorId.get(id) ?? {
          followersCount: 0,
          followingCount: 0,
          statusCount: 0
        },
        lastStatusCreatedAt: lastStatusCreatedAtByActorId.get(id)
      })
    })
  },

  async updateActor({
    actorId,
    type,
    name,
    summary,
    iconUrl,
    headerImageUrl,
    manuallyApprovesFollowers,
    postLineLimit,
    emailNotifications,
    pushNotifications,
    fitness,

    publicKey,

    followersUrl,
    inboxUrl,
    sharedInboxUrl
  }: UpdateActorParams) {
    const persistedActor = await database<SQLActor>('actors')
      .where('id', actorId)
      .first()
    if (!persistedActor) return null

    const persistedSettings = getCompatibleJSON(persistedActor.settings)
    const settings: ActorSettings = {
      ...persistedSettings,
      ...(iconUrl ? { iconUrl } : null),
      ...(headerImageUrl ? { headerImageUrl } : null),
      ...(manuallyApprovesFollowers !== undefined
        ? { manuallyApprovesFollowers }
        : null),
      ...(postLineLimit !== undefined ? { postLineLimit } : null),
      ...(emailNotifications !== undefined ? { emailNotifications } : null),
      ...(pushNotifications !== undefined ? { pushNotifications } : null),
      ...(fitness !== undefined ? { fitness } : null),

      ...(followersUrl ? { followersUrl } : null),
      ...(inboxUrl ? { inboxUrl } : null),
      ...(sharedInboxUrl ? { sharedInboxUrl } : null)
    }

    const currentTime = new Date()
    const updatedActor: SQLActor = {
      ...persistedActor,
      ...(type ? { type } : null),
      ...(name ? { name } : null),
      ...(summary ? { summary } : null),
      ...(publicKey ? { publicKey } : null),
      settings: JSON.stringify(settings),
      updatedAt: currentTime
    }

    await database.transaction(async (trx) => {
      await trx<SQLActor>('actors')
        .where('id', actorId)
        .update({
          ...(type ? { type } : null),
          ...(name ? { name } : null),
          ...(summary ? { summary } : null),

          ...(publicKey ? { publicKey } : null),

          settings: JSON.stringify(settings),
          updatedAt: currentTime
        })
      await indexActorSearchDocument(trx, {
        id: actorId,
        actor: updatedActor
      })
    })
    return this.getActorFromId({ id: actorId })
  },

  async deleteActor({ actorId }: DeleteActorParams) {
    await database.transaction(async (trx) => {
      await trx('actors').where('id', actorId).delete()
      await deleteActorSearchDocument(trx, { id: actorId })
    })
  },

  async updateActorFollowersCount(actorId: string) {
    const result = await database('follows')
      .where('targetActorId', actorId)
      .andWhere('status', 'Accepted')
      .count<{ count: string }>('* as count')
      .first()
    await setCounterValue(
      database,
      CounterKey.totalFollowers(actorId),
      parseInt(result?.count ?? '0', 10)
    )
  },

  async updateActorFollowingCount(actorId: string) {
    const result = await database('follows')
      .where('actorId', actorId)
      .andWhere('status', 'Accepted')
      .count<{ count: string }>('* as count')
      .first()
    await setCounterValue(
      database,
      CounterKey.totalFollowing(actorId),
      parseInt(result?.count ?? '0', 10)
    )
  },

  async increaseActorStatusCount(actorId: string, amount: number = 1) {
    await increaseCounterValue(
      database,
      CounterKey.totalStatus(actorId),
      amount
    )
  },

  async decreaseActorStatusCount(actorId: string, amount: number = 1) {
    await decreaseCounterValue(
      database,
      CounterKey.totalStatus(actorId),
      amount
    )
  },

  async updateActorLastStatusAt(_actorId: string, _time: number) {
    // `lastStatusAt` is derived from statuses and not persisted on actors.
  },

  async getActorFollowingCount({ actorId }: GetActorFollowingCountParams) {
    return getCounterValue(database, CounterKey.totalFollowing(actorId))
  },

  async getActorFollowersCount({ actorId }: GetActorFollowersCountParams) {
    return getCounterValue(database, CounterKey.totalFollowers(actorId))
  },

  async isInternalActor({ actorId }: IsInternalActorParams) {
    const persistedActor = await database<SQLActor>('actors')
      .where('id', actorId)
      .first()
    if (!persistedActor) return false
    if (persistedActor.accountId) return true

    return (
      persistedActor.domain === getConfiguredActorDomain() &&
      isFederationSigningActor(this.getActor(persistedActor, 0, 0, 0, 0))
    )
  },

  async getActorSettings({ actorId }: GetActorSettingsParams) {
    const persistedActor = await database<SQLActor>('actors')
      .where('id', actorId)
      .select('settings')
      .first()
    if (!persistedActor) return undefined
    return getCompatibleJSON(persistedActor.settings) as ActorSettings
  },

  async scheduleActorDeletion({
    actorId,
    scheduledAt
  }: ScheduleActorDeletionParams) {
    const currentTime = new Date()
    await database.transaction(async (trx) => {
      await trx<SQLActor>('actors').where('id', actorId).update({
        deletionStatus: 'scheduled',
        deletionScheduledAt: scheduledAt,
        updatedAt: currentTime
      })
      await indexActorSearchDocument(trx, { id: actorId })
    })
  },

  async cancelActorDeletion({ actorId }: CancelActorDeletionParams) {
    const currentTime = new Date()
    await database.transaction(async (trx) => {
      await trx<SQLActor>('actors').where('id', actorId).update({
        deletionStatus: null,
        deletionScheduledAt: null,
        updatedAt: currentTime
      })
      await indexActorSearchDocument(trx, { id: actorId })
    })
  },

  async startActorDeletion({ actorId }: StartActorDeletionParams) {
    const currentTime = new Date()
    await database.transaction(async (trx) => {
      await trx<SQLActor>('actors').where('id', actorId).update({
        deletionStatus: 'deleting',
        updatedAt: currentTime
      })
      await indexActorSearchDocument(trx, { id: actorId })
    })
  },

  async getActorsScheduledForDeletion({
    beforeDate
  }: GetActorsScheduledForDeletionParams) {
    const sqlActors = await database<SQLActor>('actors')
      .where('deletionStatus', 'scheduled')
      .andWhere('deletionScheduledAt', '<=', beforeDate)

    const results: Actor[] = []
    for (const sqlActor of sqlActors) {
      const actor = await this.getActorFromId({ id: sqlActor.id })
      if (actor) {
        results.push(actor)
      }
    }
    return results
  },

  async getActorDeletionStatus({ id }: GetActorFromIdParams) {
    const persistedActor = await database<SQLActor>('actors')
      .where('id', id)
      .select('deletionStatus', 'deletionScheduledAt')
      .first()
    if (!persistedActor) return undefined
    return {
      status: persistedActor.deletionStatus ?? null,
      scheduledAt: persistedActor.deletionScheduledAt
        ? getCompatibleTime(persistedActor.deletionScheduledAt)
        : null
    }
  },

  async getNodeInfoStats() {
    const nowSeconds = Math.floor(Date.now() / 1000)
    const ACTIVE_USERS_TTL_SECONDS = 60 * 60 // 1 hour

    const totalUsers = await getCounterValue(
      database,
      CounterKey.nodeinfoTotalUsers()
    )
    const localPosts = await getCounterValue(
      database,
      CounterKey.nodeinfoLocalPosts()
    )

    const computedAt = await getCounterValue(
      database,
      CounterKey.nodeinfoComputedAt()
    )
    const isStale =
      computedAt === 0 || nowSeconds - computedAt > ACTIVE_USERS_TTL_SECONDS

    if (!isStale) {
      const activeMonth = await getCounterValue(
        database,
        CounterKey.nodeinfoActiveMonth()
      )
      const activeHalfyear = await getCounterValue(
        database,
        CounterKey.nodeinfoActiveHalfyear()
      )
      return { totalUsers, activeMonth, activeHalfyear, localPosts }
    }

    // Recompute active user counts
    const now = Date.now()
    const oneMonthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000)
    const sixMonthsAgo = new Date(now - 180 * 24 * 60 * 60 * 1000)

    const activeCounts = await database('statuses')
      .join('actors', 'statuses.actorId', 'actors.id')
      .whereNotNull('actors.accountId')
      .andWhere('statuses.createdAt', '>=', sixMonthsAgo)
      .select(
        database.raw('count(distinct case when ?? >= ? then ?? end) as ??', [
          'statuses.createdAt',
          oneMonthAgo,
          'statuses.actorId',
          'activeMonth'
        ]),
        database.raw('count(distinct ??) as ??', [
          'statuses.actorId',
          'activeHalfyear'
        ])
      )
      .first<{
        activeMonth: string | number
        activeHalfyear: string | number
      }>()

    const activeMonth = parseInt(String(activeCounts?.activeMonth ?? '0'), 10)
    const activeHalfyear = parseInt(
      String(activeCounts?.activeHalfyear ?? '0'),
      10
    )

    const currentTime = new Date(now)
    await setCounterValue(
      database,
      CounterKey.nodeinfoActiveMonth(),
      activeMonth,
      currentTime
    )
    await setCounterValue(
      database,
      CounterKey.nodeinfoActiveHalfyear(),
      activeHalfyear,
      currentTime
    )
    await setCounterValue(
      database,
      CounterKey.nodeinfoComputedAt(),
      nowSeconds,
      currentTime
    )

    return { totalUsers, activeMonth, activeHalfyear, localPosts }
  },

  async deleteActorData({ actorId }: DeleteActorDataParams) {
    await database.transaction(async (trx) => {
      const currentTime = new Date()

      const persistedActor = await trx('actors')
        .where('id', actorId)
        .first<{ accountId: string | null }>('accountId')

      const actorStatuses = await trx('statuses')
        .where('actorId', actorId)
        .select('id', 'type', 'reply', 'content', 'originalStatusId')

      const statusIds = actorStatuses.map((status) => status.id)
      const statusReferenceToId = new Map<string, string>()
      const replyReferences = Array.from(
        new Set(
          actorStatuses
            .map((status) => status.reply)
            .filter((reply): reply is string => Boolean(reply))
        )
      )
      if (replyReferences.length > 0) {
        const replyReferenceHashes = Array.from(
          new Set(replyReferences.map((reply) => getStatusUrlHash(reply)))
        )
        const parentStatuses = await trx('statuses')
          .whereIn('id', replyReferences)
          .orWhere((builder) =>
            builder
              .whereIn('urlHash', replyReferenceHashes)
              .whereIn('url', replyReferences)
          )
          .select('id', 'url')

        for (const parentStatus of parentStatuses) {
          statusReferenceToId.set(parentStatus.id, parentStatus.id)
          if (parentStatus.url) {
            statusReferenceToId.set(parentStatus.url, parentStatus.id)
          }
        }
      }

      if (actorStatuses.length > 0) {
        await decreaseCounterValue(
          trx,
          CounterKey.totalStatus(actorId),
          actorStatuses.length,
          currentTime
        )
        await decreaseCounterValue(
          trx,
          CounterKey.serviceTotalStatuses(),
          actorStatuses.length,
          currentTime
        )
      }

      if (persistedActor?.accountId) {
        await decreaseCounterValue(
          trx,
          CounterKey.serviceTotalActors(),
          1,
          currentTime
        )
      }

      const reblogCounterChanges: Record<string, number> = {}
      const replyCounterChanges: Record<string, number> = {}
      for (const status of actorStatuses) {
        if (status.type === 'Announce') {
          const content = parseStatusContent(status.content)
          const originalStatusId =
            typeof status.originalStatusId === 'string'
              ? status.originalStatusId
              : typeof content === 'string'
                ? content
                : typeof content?.url === 'string'
                  ? content.url
                  : typeof status.content === 'string'
                    ? status.content
                    : null

          if (originalStatusId) {
            reblogCounterChanges[originalStatusId] =
              (reblogCounterChanges[originalStatusId] || 0) + 1
          }
        }

        if (status.reply) {
          const parentStatusId = statusReferenceToId.get(status.reply)
          if (parentStatusId) {
            replyCounterChanges[parentStatusId] =
              (replyCounterChanges[parentStatusId] || 0) + 1
          }
        }
      }

      for (const [statusId, count] of Object.entries(reblogCounterChanges)) {
        await decreaseCounterValue(
          trx,
          CounterKey.totalReblog(statusId),
          count,
          currentTime
        )
      }
      for (const [statusId, count] of Object.entries(replyCounterChanges)) {
        await decreaseCounterValue(
          trx,
          CounterKey.totalReply(statusId),
          count,
          currentTime
        )
      }

      const acceptedFollowing = await trx('follows')
        .where('actorId', actorId)
        .andWhere('status', 'Accepted')
        .select('targetActorId')

      if (acceptedFollowing.length > 0) {
        await decreaseCounterValue(
          trx,
          CounterKey.totalFollowing(actorId),
          acceptedFollowing.length,
          currentTime
        )

        const followerAdjustments: Record<string, number> = {}
        for (const follow of acceptedFollowing) {
          followerAdjustments[follow.targetActorId] =
            (followerAdjustments[follow.targetActorId] || 0) + 1
        }
        for (const [targetActorId, count] of Object.entries(
          followerAdjustments
        )) {
          await decreaseCounterValue(
            trx,
            CounterKey.totalFollowers(targetActorId),
            count,
            currentTime
          )
        }
      }

      const acceptedFollowers = await trx('follows')
        .where('targetActorId', actorId)
        .andWhere('status', 'Accepted')
        .select('actorId')
      if (acceptedFollowers.length > 0) {
        await decreaseCounterValue(
          trx,
          CounterKey.totalFollowers(actorId),
          acceptedFollowers.length,
          currentTime
        )

        const followingAdjustments: Record<string, number> = {}
        for (const follow of acceptedFollowers) {
          followingAdjustments[follow.actorId] =
            (followingAdjustments[follow.actorId] || 0) + 1
        }

        for (const [followerActorId, count] of Object.entries(
          followingAdjustments
        )) {
          await decreaseCounterValue(
            trx,
            CounterKey.totalFollowing(followerActorId),
            count,
            currentTime
          )
        }
      }

      const likesMadeByActor = await trx('likes')
        .where('actorId', actorId)
        .select('statusId')
      const likeAdjustments: Record<string, number> = {}
      for (const like of likesMadeByActor) {
        likeAdjustments[like.statusId] =
          (likeAdjustments[like.statusId] || 0) + 1
      }
      for (const [statusId, count] of Object.entries(likeAdjustments)) {
        await decreaseCounterValue(
          trx,
          CounterKey.totalLike(statusId),
          count,
          currentTime
        )
      }

      const medias = await trx('medias')
        .where('actorId', actorId)
        .select('originalBytes', 'thumbnailBytes')
      const totalMediaBytes = medias.reduce(
        (sum, media) =>
          sum +
          parseCounterValue(media.originalBytes) +
          parseCounterValue(media.thumbnailBytes),
        0
      )
      if (persistedActor?.accountId && totalMediaBytes > 0) {
        await decreaseCounterValue(
          trx,
          CounterKey.mediaUsage(persistedActor.accountId),
          totalMediaBytes,
          currentTime
        )
      }

      if (statusIds.length > 0) {
        const hashtagTags = await selectHashtagTagsByStatusIds(trx, statusIds)
        const affectedHashtags = [
          ...new Set(hashtagTags.map((tag) => tag.nameNormalized ?? tag.name))
        ]

        // Get poll choice IDs before deleting them
        const pollChoices = await selectPollChoiceIdsByStatusIds(trx, statusIds)
        const choiceIds = pollChoices.map((choice) => choice.choiceId)

        // Delete status-related data
        await deleteRowsByColumnChunks(trx, 'tags', 'statusId', statusIds)
        await deleteRowsByColumnChunks(trx, 'recipients', 'statusId', statusIds)
        await deleteRowsByColumnChunks(trx, 'likes', 'statusId', statusIds)
        await deleteRowsByColumnChunks(trx, 'bookmarks', 'statusId', statusIds)
        await deleteRowsByColumnChunks(
          trx,
          'attachments',
          'statusId',
          statusIds
        )
        await deleteRowsByColumnChunks(
          trx,
          'status_history',
          'statusId',
          statusIds
        )

        // Delete poll answers before deleting poll choices
        if (choiceIds.length > 0) {
          await deleteRowsByColumnChunks(
            trx,
            'poll_answers',
            'answerId',
            choiceIds
          )
        }
        await deleteRowsByColumnChunks(
          trx,
          'poll_choices',
          'statusId',
          statusIds
        )
        if (affectedHashtags.length > 0) {
          await indexHashtagSearchDocuments(trx, {
            hashtags: affectedHashtags
          })
        }
      }

      // Delete timeline entries for this actor
      await trx('timelines').where('actorId', actorId).delete()
      await trx('timelines').where('statusActorId', actorId).delete()

      // Delete statuses
      await trx('statuses').where('actorId', actorId).delete()

      // Delete follows (both directions)
      await trx('follows').where('actorId', actorId).delete()
      await trx('follows').where('targetActorId', actorId).delete()

      const blocks = await trx('blocks')
        .where('actorId', actorId)
        .orWhere('targetActorId', actorId)
        .select('actorId', 'targetActorId')
      const blockingAdjustments: Record<string, number> = {}
      const blockedByAdjustments: Record<string, number> = {}
      for (const block of blocks) {
        if (block.actorId !== actorId) {
          blockingAdjustments[block.actorId] =
            (blockingAdjustments[block.actorId] || 0) + 1
        }
        if (block.targetActorId !== actorId) {
          blockedByAdjustments[block.targetActorId] =
            (blockedByAdjustments[block.targetActorId] || 0) + 1
        }
      }
      await Promise.all([
        ...Object.entries(blockingAdjustments).map(([blockingActorId, count]) =>
          decreaseCounterValue(
            trx,
            CounterKey.totalBlocking(blockingActorId),
            count,
            currentTime
          )
        ),
        ...Object.entries(blockedByAdjustments).map(([blockedActorId, count]) =>
          decreaseCounterValue(
            trx,
            CounterKey.totalBlockedBy(blockedActorId),
            count,
            currentTime
          )
        )
      ])
      await trx('blocks')
        .where((builder) => {
          builder.where('actorId', actorId).orWhere('targetActorId', actorId)
        })
        .delete()

      // Delete likes made by this actor
      await trx('likes').where('actorId', actorId).delete()

      // Delete bookmarks made by this actor
      await trx('bookmarks').where('actorId', actorId).delete()

      // Delete attachments created by this actor
      await trx('attachments').where('actorId', actorId).delete()

      // Delete medias created by this actor
      await trx('medias').where('actorId', actorId).delete()

      await deleteCounterValue(trx, CounterKey.totalStatus(actorId))
      await deleteCounterValue(trx, CounterKey.totalFollowers(actorId))
      await deleteCounterValue(trx, CounterKey.totalFollowing(actorId))
      await deleteCounterValue(trx, CounterKey.totalBlocking(actorId))
      await deleteCounterValue(trx, CounterKey.totalBlockedBy(actorId))

      if (persistedActor?.accountId) {
        await decreaseCounterValue(
          trx,
          CounterKey.nodeinfoTotalUsers(),
          1,
          currentTime
        )
        if (actorStatuses.length > 0) {
          await decreaseCounterValue(
            trx,
            CounterKey.nodeinfoLocalPosts(),
            actorStatuses.length,
            currentTime
          )
        }
      }

      for (const statusId of statusIds) {
        await deleteCounterValue(trx, CounterKey.totalLike(statusId))
        await deleteCounterValue(trx, CounterKey.totalReblog(statusId))
        await deleteCounterValue(trx, CounterKey.totalReply(statusId))
      }

      // Delete notifications table entries if exists
      try {
        await trx('notifications').where('actorId', actorId).delete()
        await trx('notifications').where('sourceActorId', actorId).delete()
      } catch {
        // Table might not exist in older migrations
      }

      // Finally delete the actor
      await trx('actors').where('id', actorId).delete()
      await deleteActorSearchDocument(trx, { id: actorId })
    })
  }
})
