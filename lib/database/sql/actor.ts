import { Knex } from 'knex'

import { getConfig } from '@/lib/config'
import {
  deleteActorSearchDocument,
  deleteStatusSearchDocumentsByStatusIds,
  indexActorSearchDocument,
  indexHashtagSearchDocuments,
  normalizeHashtagSearchName
} from '@/lib/database/sql/search'
import {
  CounterKey,
  decreaseCounterValue,
  deleteCounterValue,
  deleteCounterValues,
  getCounterValue,
  getCounterValues,
  increaseCounterValue,
  parseCounterValue,
  setCounterValue
} from '@/lib/database/sql/utils/counter'
import { getCompatibleJSON } from '@/lib/database/sql/utils/getCompatibleJSON'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  chunkArray,
  deleteRowsByColumnChunks,
  getWhereInBatchSize,
  isPostgresClient
} from '@/lib/database/sql/utils/knex'
import { parseStatusContent } from '@/lib/database/sql/utils/parseStatusContent'
import { selectHashtagTagsByStatusIds } from '@/lib/database/sql/utils/status'
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
  DEFAULT_NOTIFICATION_POLICY,
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
  GetLocalActorsParams,
  IsCurrentActorFollowingParams,
  IsInternalActorParams,
  NotificationPolicy,
  ScheduleActorDeletionParams,
  StartActorDeletionParams,
  UpdateActorParams,
  UpdateNotificationPolicyParams
} from '@/lib/types/database/operations'
import { ActorSettings, SQLAccount, SQLActor } from '@/lib/types/database/rows'
import { Account } from '@/lib/types/domain/account'
import { Actor, ActorType } from '@/lib/types/domain/actor'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { logger } from '@/lib/utils/logger'
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

const getActorCounterSummary = async (
  database: Knex | Knex.Transaction,
  actorId: string
): Promise<{
  followersCount: number
  followingCount: number
  statusCount: number
}> => {
  const counters = await getCounterValues(database, [
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

// The persisted `lastStatusAt` as an epoch-millis number for the domain `Actor`
// (0 when the actor has never posted). `lastStatusAt` is now a column on
// `actors` maintained inside the status create/delete transactions, so callers
// read it straight off the row instead of re-aggregating `statuses`.
const getSqlActorLastStatusAtTime = (sqlActor: SQLActor): number =>
  sqlActor.lastStatusAt ? getCompatibleTime(sqlActor.lastStatusAt) : 0

const getMastodonAccountFromSQLActor = ({
  sqlActor,
  counters
}: {
  sqlActor: SQLActor
  counters: {
    followersCount: number
    followingCount: number
    statusCount: number
  }
}) => {
  const settings = getCompatibleJSON(sqlActor.settings)
  const isLocalHeadlessSigner = isValidFederationSigningSQLActor(
    sqlActor,
    getConfiguredActorDomain()
  )

  // Mastodon `acct` is bare only for actors whose domain is the instance's own
  // (configured) host; every other actor — remote, OR one we host on a
  // *different* domain — must use the `username@domain` form. Comparing against
  // the configured host (not merely "do we host this actor") keeps a Mastodon
  // client from collapsing two same-username actors on different local domains
  // into one account (which renders as a blank account-switcher row). Domains
  // are case-insensitive, so compare case-insensitively.
  const isLocalActor =
    sqlActor.domain.toLowerCase() === getConfiguredActorDomain().toLowerCase()
  // Canonicalize the domain part to lowercase: Mastodon normalizes domains, and
  // some clients/servers string-match `acct` strictly.
  const qualifiedAcct = `${sqlActor.username}@${sqlActor.domain.toLowerCase()}`

  // Profile metadata fields are stored as plain name/value pairs; URLs are not
  // server-verified, so verified_at is always null.
  const profileFields = (settings.fields ?? []).map((field) => ({
    name: field.name,
    value: field.value,
    verified_at: null
  }))
  const note = sqlActor.summary ?? ''

  return Mastodon.Account.parse({
    id: urlToId(sqlActor.id),
    username: sqlActor.username,
    acct: isLocalActor ? sqlActor.username : qualifiedAcct,
    url: sqlActor.id,
    display_name: sqlActor.name ?? '',
    note,

    avatar: settings.iconUrl ?? '',
    avatar_static: settings.iconUrl ?? '',
    header: settings.headerImageUrl ?? '',
    header_static: settings.headerImageUrl ?? '',

    fields: profileFields,
    emojis: [],

    locked: settings.manuallyApprovesFollowers ?? true,
    bot: isMastodonBotActorType(sqlActor.type) || settings.bot === true,
    group: sqlActor.type === 'Group',
    discoverable: settings.discoverable ?? !isLocalHeadlessSigner,
    noindex: isLocalHeadlessSigner,

    // `source.note` is the plain-text bio and `source.fields` mirror the public
    // fields. The default privacy/sensitive/language come from the account's
    // saved posting preferences. follow_requests_count is left at 0 here so the
    // public Account never leaks it; the credential endpoints overlay the real
    // count (see lib/services/accounts/credentialAccount).
    source: {
      note,
      fields: profileFields,
      privacy: settings.defaultPrivacy ?? 'public',
      sensitive: settings.defaultSensitive ?? false,
      language: settings.defaultLanguage ?? 'en',
      follow_requests_count: 0
    },

    created_at: getISOTimeUTC(getCompatibleTime(sqlActor.createdAt)),
    last_status_at: sqlActor.lastStatusAt
      ? getISOTimeUTC(getCompatibleTime(sqlActor.lastStatusAt), true)
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

    const [account, counters] = await database.transaction(async (trx) => {
      return Promise.all([
        trx<Account>('accounts').where('id', persistedActor.accountId).first(),
        getActorCounterSummary(trx, persistedActor.id)
      ])
    })

    return this.getActor(
      persistedActor,
      counters.followingCount,
      counters.followersCount,
      counters.statusCount,
      getSqlActorLastStatusAtTime(persistedActor),
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

    const [account, counters] = await database.transaction(async (trx) => {
      return Promise.all([
        trx<Account>('accounts').where('id', persistedActor.accountId).first(),
        getActorCounterSummary(trx, persistedActor.id)
      ])
    })

    return this.getActor(
      persistedActor,
      counters.followingCount,
      counters.followersCount,
      counters.statusCount,
      getSqlActorLastStatusAtTime(persistedActor),
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
      const counters = await getActorCounterSummary(database, persistedActor.id)
      return this.getActor(
        persistedActor,
        counters.followingCount,
        counters.followersCount,
        counters.statusCount,
        getSqlActorLastStatusAtTime(persistedActor)
      )
    }

    const [account, counters] = await database.transaction(async (trx) => {
      return Promise.all([
        trx<Account>('accounts').where('id', persistedActor.accountId).first(),
        getActorCounterSummary(trx, persistedActor.id)
      ])
    })

    return this.getActor(
      persistedActor,
      counters.followingCount,
      counters.followersCount,
      counters.statusCount,
      getSqlActorLastStatusAtTime(persistedActor),
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
    const [accounts, countersByActorId] = await Promise.all([
      accountIds.length > 0
        ? database<SQLAccount>('accounts').whereIn('id', accountIds)
        : [],
      getActorCounterSummaries(database, actorIds)
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

        return this.getActor(
          actor,
          counters.followingCount,
          counters.followersCount,
          counters.statusCount,
          getSqlActorLastStatusAtTime(actor),
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
      // Booleans use !== undefined so a persisted `false` survives the
      // row-to-domain round-trip (a truthy spread would drop it).
      ...(settings.readingExpandMedia !== undefined
        ? { readingExpandMedia: settings.readingExpandMedia }
        : null),
      ...(settings.readingExpandSpoilers !== undefined
        ? { readingExpandSpoilers: settings.readingExpandSpoilers }
        : null),
      ...(settings.readingAutoplayGifs !== undefined
        ? { readingAutoplayGifs: settings.readingAutoplayGifs }
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

  async getLocalMastodonActors({
    localDomain,
    limit = 40,
    offset = 0,
    order = 'active'
  }: GetLocalActorsParams) {
    // Actors store the bare host in `domain`, but callers may pass a configured
    // host that includes a scheme (e.g. `https://example.com`). Normalize so the
    // comparison matches.
    const normalizedDomain = localDomain.includes('://')
      ? new URL(localDomain).host
      : localDomain
    const query = database<SQLActor>('actors')
      .where('domain', normalizedDomain)
      .whereNotNull('accountId')

    if (order === 'active') {
      // Mastodon's `active` order is most-recently-active first, using the
      // persisted `lastStatusAt`. Actors who have never posted (NULL) sort last
      // on both SQLite and PostgreSQL: `(lastStatusAt IS NULL)` yields 0 before
      // 1, so an explicit `NULLS LAST` — which the two dialects disagree on by
      // default — is not needed. `createdAt` breaks ties deterministically.
      query
        .orderByRaw('(?? is null) asc', ['lastStatusAt'])
        .orderBy('lastStatusAt', 'desc')
        .orderBy('createdAt', 'desc')
    } else {
      // `new` order is most-recently-created first.
      query.orderBy('createdAt', 'desc')
    }

    const rows = await query.limit(limit).offset(offset).pluck('id')

    return this.getMastodonActors(rows)
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
    const countersByActorId = await getActorCounterSummaries(
      database,
      existingActorIds
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
        }
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
    fields,
    bot,
    discoverable,
    defaultPrivacy,
    defaultSensitive,
    defaultLanguage,
    postLineLimit,
    readingExpandMedia,
    readingExpandSpoilers,
    readingAutoplayGifs,
    emailNotifications,
    pushNotifications,
    notificationPolicy,
    notificationAcceptedSenders,
    appendNotificationAcceptedSenders,
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
    // The explicit settings changes requested by this call (undefined fields
    // mean "no change"). Kept as a standalone object so the
    // appendNotificationAcceptedSenders path can re-apply them on top of the
    // fresh in-transaction read without losing any of them.
    const settingsUpdates: Partial<ActorSettings> = {
      ...(iconUrl ? { iconUrl } : null),
      ...(headerImageUrl ? { headerImageUrl } : null),
      ...(manuallyApprovesFollowers !== undefined
        ? { manuallyApprovesFollowers }
        : null),
      ...(fields !== undefined ? { fields } : null),
      ...(bot !== undefined ? { bot } : null),
      ...(discoverable !== undefined ? { discoverable } : null),
      ...(defaultPrivacy !== undefined ? { defaultPrivacy } : null),
      ...(defaultSensitive !== undefined ? { defaultSensitive } : null),
      ...(defaultLanguage !== undefined ? { defaultLanguage } : null),
      ...(postLineLimit !== undefined ? { postLineLimit } : null),
      ...(readingExpandMedia !== undefined ? { readingExpandMedia } : null),
      ...(readingExpandSpoilers !== undefined
        ? { readingExpandSpoilers }
        : null),
      ...(readingAutoplayGifs !== undefined ? { readingAutoplayGifs } : null),
      ...(emailNotifications !== undefined ? { emailNotifications } : null),
      ...(pushNotifications !== undefined ? { pushNotifications } : null),
      ...(notificationPolicy !== undefined ? { notificationPolicy } : null),
      ...(notificationAcceptedSenders !== undefined
        ? { notificationAcceptedSenders }
        : null),
      // appendNotificationAcceptedSenders is handled inside the transaction
      // with a fresh read to prevent lost-update races.
      ...(fitness !== undefined ? { fitness } : null),

      ...(followersUrl ? { followersUrl } : null),
      ...(inboxUrl ? { inboxUrl } : null),
      ...(sharedInboxUrl ? { sharedInboxUrl } : null)
    }
    // A null iconUrl/headerImageUrl means "explicitly clear this field"
    // (distinct from undefined = "no change"). ActorSettings types these as
    // optional strings, so we drop the key rather than storing null. Centralized
    // here so every derived settings object (pre-transaction and the
    // append-path rebuild) clears them the same way.
    const applyExplicitClears = (target: ActorSettings): ActorSettings => {
      if (iconUrl === null) delete target.iconUrl
      if (headerImageUrl === null) delete target.headerImageUrl
      return target
    }

    const settings = applyExplicitClears({
      ...persistedSettings,
      ...settingsUpdates
    })

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
      let finalSettings = settings

      if (appendNotificationAcceptedSenders !== undefined) {
        // Re-read inside the transaction (with row lock on PostgreSQL) to merge
        // accepted senders atomically and avoid lost-update races.
        const freshActorQuery = trx<SQLActor>('actors').where('id', actorId)
        if (isPostgresClient(database)) freshActorQuery.forUpdate()
        const freshActor = await freshActorQuery.first()
        if (freshActor) {
          const freshSettings = getCompatibleJSON<ActorSettings>(
            freshActor.settings
          )
          const existing = new Set(
            freshSettings?.notificationAcceptedSenders ?? []
          )
          const toAdd = appendNotificationAcceptedSenders.filter(
            (id) => !existing.has(id)
          )
          // Base the merge on freshSettings so all settings fields (policy,
          // email/push notifications, etc.) come from the locked row, not the
          // stale pre-transaction snapshot. This prevents concurrent settings
          // changes from being clobbered by this write. Re-apply this call's
          // own explicit settingsUpdates on top so they are not lost when an
          // append is combined with other settings changes in the same call,
          // then re-clear any explicitly-nulled fields.
          finalSettings = applyExplicitClears({
            ...freshSettings,
            ...settingsUpdates,
            notificationAcceptedSenders: [...existing, ...toAdd]
          })
        }
      }

      await trx<SQLActor>('actors')
        .where('id', actorId)
        .update({
          ...(type ? { type } : null),
          ...(name ? { name } : null),
          ...(summary ? { summary } : null),

          ...(publicKey ? { publicKey } : null),

          settings: JSON.stringify(finalSettings),
          updatedAt: currentTime
        })
      await indexActorSearchDocument(trx, {
        id: actorId,
        actor: { ...updatedActor, settings: JSON.stringify(finalSettings) }
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

  async updateActorLastStatusAt(actorId: string, time: number) {
    // Guarded set-if-newer so an out-of-order or backdated write cannot lower a
    // more recent value. The status create path maintains this inline inside its
    // own transaction; this method exists for callers outside that path.
    const lastStatusAt = new Date(time)
    await database<SQLActor>('actors')
      .where('id', actorId)
      .andWhere((builder) =>
        builder
          .whereNull('lastStatusAt')
          .orWhere('lastStatusAt', '<', lastStatusAt)
      )
      .update({ lastStatusAt })
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

  async getNotificationPolicy({ actorId }: GetActorSettingsParams) {
    const settings = await this.getActorSettings({ actorId })
    return {
      ...DEFAULT_NOTIFICATION_POLICY,
      ...(settings?.notificationPolicy ?? {})
    }
  },

  async updateNotificationPolicy({
    actorId,
    ...partial
  }: UpdateNotificationPolicyParams) {
    const current = await this.getNotificationPolicy({ actorId })
    const notificationPolicy: NotificationPolicy = { ...current, ...partial }
    await this.updateActor({ actorId, notificationPolicy })
    return notificationPolicy
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
    const affectedHashtags: string[] = []

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
        affectedHashtags.push(...hashtagTags.map((tag) => tag.name))
        const hashtagCounterAdjustments = new Map<string, number>()
        for (const tag of hashtagTags) {
          const tagName = normalizeHashtagSearchName(tag.name)
          if (tagName.length === 0) continue
          hashtagCounterAdjustments.set(
            tagName,
            (hashtagCounterAdjustments.get(tagName) ?? 0) + 1
          )
        }
        for (const [tagName, count] of hashtagCounterAdjustments) {
          await decreaseCounterValue(
            trx,
            CounterKey.totalHashtag(tagName),
            count,
            currentTime
          )
        }

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
        await deleteRowsByColumnChunks(
          trx,
          'poll_answers',
          'statusId',
          statusIds
        )
        await deleteRowsByColumnChunks(
          trx,
          'poll_voters',
          'statusId',
          statusIds
        )
        await deleteRowsByColumnChunks(
          trx,
          'poll_choices',
          'statusId',
          statusIds
        )
        await deleteRowsByColumnChunks(
          trx,
          'notifications',
          'statusId',
          statusIds
        )
        await deleteRowsByColumnChunks(
          trx,
          'direct_conversation_statuses',
          'statusId',
          statusIds
        )
        for (const statusIdChunk of chunkArray(
          statusIds,
          getWhereInBatchSize(trx)
        )) {
          await trx('fitness_files')
            .whereIn('statusId', statusIdChunk)
            .update({ statusId: null })
        }
      }

      // Delete timeline entries for this actor
      await trx('timelines').where('actorId', actorId).delete()
      await trx('timelines').where('statusActorId', actorId).delete()

      // Delete statuses
      await trx('statuses').where('actorId', actorId).delete()
      if (statusIds.length > 0) {
        await deleteStatusSearchDocumentsByStatusIds(trx, statusIds)
      }

      // Delete follows (both directions)
      await trx('follows').where('actorId', actorId).delete()
      await trx('follows').where('targetActorId', actorId).delete()

      // Delete endorsements (both as endorser and endorsed)
      await trx('endorsements').where('actorId', actorId).delete()
      await trx('endorsements').where('targetActorId', actorId).delete()

      // Delete the actor's featured tags.
      await trx('featured_tags').where('actorId', actorId).delete()

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

      await trx('mutes')
        .where((builder) => {
          builder.where('actorId', actorId).orWhere('targetActorId', actorId)
        })
        .delete()

      // Private account notes reference the actor on either side (author or
      // target); remove both so a recreated actor URL cannot resurface them.
      await trx('account_notes')
        .where((builder) => {
          builder.where('actorId', actorId).orWhere('targetActorId', actorId)
        })
        .delete()

      // Subquery avoids hitting the SQLite 999-parameter limit when an
      // actor has accumulated many filters; the mute precedent only
      // touches one table per actor so doesn't need this.
      await trx('filter_statuses')
        .whereIn('filterId', function () {
          this.select('id').from('filters').where('actorId', actorId)
        })
        .delete()
      await trx('filter_keywords')
        .whereIn('filterId', function () {
          this.select('id').from('filters').where('actorId', actorId)
        })
        .delete()
      await trx('filters').where('actorId', actorId).delete()

      // Delete likes made by this actor
      await trx('likes').where('actorId', actorId).delete()

      // Delete bookmarks made by this actor
      await trx('bookmarks').where('actorId', actorId).delete()

      // Delete markers made by this actor
      await trx('markers').where('actorId', actorId).delete()

      const pollAnswersMadeByActor: { statusId: string; choice: number }[] =
        await trx('poll_answers')
          .where('actorId', actorId)
          .select('statusId', 'choice')
      if (pollAnswersMadeByActor.length > 0) {
        const choiceIdsByStatusId = new Map<string, number[]>()
        const votedStatusIds = [
          ...new Set(pollAnswersMadeByActor.map((answer) => answer.statusId))
        ]

        for (const statusIdChunk of chunkArray(
          votedStatusIds,
          getWhereInBatchSize(trx)
        )) {
          const pollChoices: { statusId: string; choiceId: number }[] =
            await trx('poll_choices')
              .whereIn('statusId', statusIdChunk)
              .orderBy('statusId', 'asc')
              .orderBy('choiceId', 'asc')
              .select('statusId', 'choiceId')

          for (const choice of pollChoices) {
            const choices = choiceIdsByStatusId.get(choice.statusId) ?? []
            choices.push(choice.choiceId)
            choiceIdsByStatusId.set(choice.statusId, choices)
          }
        }

        const pollChoiceDecrements = new Map<
          string,
          { statusId: string; choiceId: number; count: number }
        >()
        for (const answer of pollAnswersMadeByActor) {
          const choiceId = choiceIdsByStatusId.get(answer.statusId)?.[
            Number(answer.choice)
          ]
          if (choiceId === undefined) continue

          const key = `${answer.statusId}:${choiceId}`
          const existing = pollChoiceDecrements.get(key) ?? {
            statusId: answer.statusId,
            choiceId,
            count: 0
          }
          existing.count += 1
          pollChoiceDecrements.set(key, existing)
        }

        for (const {
          statusId,
          choiceId,
          count
        } of pollChoiceDecrements.values()) {
          await trx('poll_choices')
            .where({ statusId, choiceId })
            .update({
              totalVotes: trx.raw('CASE WHEN ?? > ? THEN ?? - ? ELSE 0 END', [
                'totalVotes',
                count,
                'totalVotes',
                count
              ])
            })
        }
      }

      // Delete poll votes cast by this actor on other actors' polls
      await trx('poll_answers').where('actorId', actorId).delete()
      await trx('poll_voters').where('actorId', actorId).delete()

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

      await deleteCounterValues(
        trx,
        statusIds.flatMap((statusId) => [
          CounterKey.totalLike(statusId),
          CounterKey.totalReblog(statusId),
          CounterKey.totalReply(statusId)
        ])
      )

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

    if (affectedHashtags.length > 0) {
      try {
        await indexHashtagSearchDocuments(database, {
          hashtags: [...new Set(affectedHashtags)]
        })
      } catch (err) {
        logger.warn(
          {
            actorId,
            err,
            hashtags: [...new Set(affectedHashtags)]
          },
          'Failed to refresh hashtag search documents after actor deletion'
        )
      }
    }
  }
})
