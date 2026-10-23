// Pure, synchronous mappers from an `actors` row (and its account) to the
// domain Actor and to the Mastodon Account entity. No database access, so a
// caller inside a transaction can use them directly, as the follow queries'
// getLocalActorsFromFollowerUrl does. They accept a timestamp as epoch ms, a
// Date or SQLite text, and `settings` as JSON text or parsed.
import { getConfig } from '@/lib/config'
import { getCompatibleJSON } from '@/lib/database/utils/getCompatibleJSON'
import { getCompatibleTime } from '@/lib/database/utils/getCompatibleTime'
import {
  FEDERATION_SIGNING_ACTOR_TYPE,
  isFederationSigningActorUsername
} from '@/lib/services/federation/instanceActor'
import { Mastodon } from '@/lib/types/activitypub'
import type {
  ActorSettings,
  SQLAccount,
  SQLActor
} from '@/lib/types/database/rows'
import { Account } from '@/lib/types/domain/account'
import { Actor, ActorType } from '@/lib/types/domain/actor'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { getClientActorId } from '@/lib/utils/publicId'
import { formatProfileFieldValue } from '@/lib/utils/text/formatProfileFieldValue'
import { toEmojiShortcodeToken } from '@/lib/utils/text/getEmojiTags'
import { sanitizeText } from '@/lib/utils/text/sanitizeText'

export type ActorCounters = {
  followersCount: number
  followingCount: number
  statusCount: number
}

export const EMPTY_ACTOR_COUNTERS: ActorCounters = {
  followersCount: 0,
  followingCount: 0,
  statusCount: 0
}

// A Kysely `actors` row as the mappers read it.
export const asSQLActor = (row: object) => row as SQLActor

// A nullable timestamp as epoch ms, or null. Epoch 0 is a value, not unset.
const optionalTime = (value: number | Date | string | null | undefined) =>
  value != null ? getCompatibleTime(value) : null

export const getSettings = (sqlActor: SQLActor) =>
  getCompatibleJSON<ActorSettings>(sqlActor.settings)

export const getConfiguredActorDomain = () => {
  const host = getConfig().host
  return host.includes('://') ? new URL(host).host : host
}

export const isValidFederationSigningSQLActor = (
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

const isMastodonBotActorType = (type: SQLActor['type']) =>
  type === 'Service' || type === 'Application' || type === 'Organization'

const getAccountEmojisFromTags = (
  tags?: { type: string; name: string; value: string }[]
): Mastodon.CustomEmoji[] => {
  if (!tags) return []
  return tags
    .filter((tag) => tag.type === 'emoji')
    .flatMap((tag) => {
      const token = toEmojiShortcodeToken(tag.name)
      if (!token) return []
      return [
        {
          shortcode: token.slice(1, -1),
          url: tag.value,
          static_url: tag.value,
          visible_in_picker: true,
          category: null
        }
      ]
    })
}

// The persisted `lastStatusAt` as an epoch-millis number for the domain `Actor`
// (0 when the actor has never posted). `lastStatusAt` is a column on `actors`
// maintained inside the status create/delete transactions, so callers read it
// straight off the row instead of re-aggregating `statuses`.
export const getSqlActorLastStatusAtTime = (sqlActor: SQLActor): number =>
  sqlActor.lastStatusAt ? getCompatibleTime(sqlActor.lastStatusAt) : 0

const getDomainAccount = (sqlAccount: SQLAccount) =>
  Account.parse({
    ...sqlAccount,
    createdAt: getCompatibleTime(sqlAccount.createdAt),
    updatedAt: getCompatibleTime(sqlAccount.updatedAt),
    verifiedAt: optionalTime(sqlAccount.verifiedAt),
    emailVerifiedAt: optionalTime(sqlAccount.emailVerifiedAt),
    emailChangeCodeExpiresAt: optionalTime(sqlAccount.emailChangeCodeExpiresAt),
    passwordResetCodeExpiresAt: optionalTime(
      sqlAccount.passwordResetCodeExpiresAt
    ),
    disabledAt: optionalTime(sqlAccount.disabledAt),
    approvedAt: optionalTime(sqlAccount.approvedAt),
    twoFactorEnabled:
      sqlAccount.twoFactorEnabled != null
        ? Boolean(sqlAccount.twoFactorEnabled)
        : false,
    // Coerced like `twoFactorEnabled`: SQLite stores booleans as 0/1, which
    // `z.boolean()` rejects.
    emailVerified:
      sqlAccount.emailVerified != null
        ? Boolean(sqlAccount.emailVerified)
        : false
  })

export const getActor = (
  sqlActor: SQLActor,
  followingCount: number,
  followersCount: number,
  statusCount: number,
  lastStatusAt: number,
  sqlAccount?: SQLAccount
): Actor => {
  const settings = getSettings(sqlActor)
  return Actor.parse({
    id: sqlActor.id,
    publicId: sqlActor.publicId ?? null,
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
    ...(settings.tags ? { tags: settings.tags } : null),
    ...(settings.discoverable !== undefined
      ? { discoverable: settings.discoverable }
      : null),
    ...(settings.indexable !== undefined
      ? { indexable: settings.indexable }
      : null),
    ...(settings.movedTo ? { movedTo: settings.movedTo } : null),
    ...(settings.alsoKnownAs?.length
      ? { alsoKnownAs: settings.alsoKnownAs }
      : null),
    ...(settings.attributionDomains?.length
      ? { attributionDomains: settings.attributionDomains }
      : null),
    ...(settings.fields?.length ? { fields: settings.fields } : null),
    ...(settings.linksCheckedAt
      ? { linksCheckedAt: settings.linksCheckedAt }
      : null),
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
    // Profile tab visibility, only when the owner set it.
    ...(settings.showReplies !== undefined
      ? { showReplies: settings.showReplies }
      : null),
    ...(settings.showMedia !== undefined
      ? { showMedia: settings.showMedia }
      : null),
    ...(settings.showGallery !== undefined
      ? { showGallery: settings.showGallery }
      : null),
    ...(settings.showFitness !== undefined
      ? { showFitness: settings.showFitness }
      : null),
    followersUrl: settings.followersUrl,
    inboxUrl: settings.inboxUrl,
    sharedInboxUrl: settings.sharedInboxUrl,
    publicKey: sqlActor.publicKey,
    ...(sqlActor.privateKey ? { privateKey: sqlActor.privateKey } : null),
    ...(sqlAccount ? { account: getDomainAccount(sqlAccount) } : null),

    followingCount,
    followersCount,

    statusCount,
    lastStatusAt,

    createdAt: getCompatibleTime(sqlActor.createdAt),
    updatedAt: getCompatibleTime(sqlActor.updatedAt),
    deletionStatus: sqlActor.deletionStatus ?? null,
    deletionScheduledAt: optionalTime(sqlActor.deletionScheduledAt),
    suspendedAt: optionalTime(sqlActor.suspendedAt),
    silencedAt: optionalTime(sqlActor.silencedAt),
    sensitizedAt: optionalTime(sqlActor.sensitizedAt)
  })
}

// The single Account emission point: every embedded `account` (statuses,
// notifications, search, reactions, favourited_by, …) flips through here.
export const getMastodonAccountFromSQLActor = (
  sqlActor: SQLActor,
  counters: ActorCounters,
  // The account a remote actor moved to, when its row is stored here.
  moved?: Mastodon.Account
) => {
  const settings = getSettings(sqlActor)
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

  // Profile metadata fields are stored as name/value pairs. `verified_at` is
  // when VerifyProfileLinksJob saw the value's page link back with rel="me".
  const sourceFields = (settings.fields ?? []).map((field) => ({
    name: field.name,
    value: field.value,
    verified_at: field.verifiedAt ? getISOTimeUTC(field.verifiedAt) : null
  }))
  const sourceNote = sqlActor.summary ?? ''
  // `note` and `fields[].value` are HTML in the Mastodon Account entity, and
  // clients render them as server-sanitized markup. The stored values are raw:
  // a local user's bio is whatever they typed, a remote actor's is whatever
  // its server sent. Sanitize here — the single Account emission point — so
  // no embedded account can carry scriptable HTML to a client. `source` keeps
  // the raw values: it is the plain-text editing copy (and feeds Profile).
  // A local actor's field is plain text, so it is formatted as the HTML the
  // actor document carries (see formatProfileFieldValue, which escapes it); a
  // remote actor's stored value is already HTML and is sanitized.
  const hostsActor = Boolean(sqlActor.privateKey)
  const profileFields = sourceFields.map((field) => ({
    ...field,
    value: hostsActor
      ? formatProfileFieldValue(field.value)
      : sanitizeText(field.value)
  }))
  const note = sanitizeText(sourceNote)
  const lastStatusAt = optionalTime(sqlActor.lastStatusAt)

  return Mastodon.Account.parse({
    // A row that predates the publicId backfill keeps emitting the legacy
    // encoding.
    id: getClientActorId(sqlActor),
    username: sqlActor.username,
    acct: isLocalActor ? sqlActor.username : qualifiedAcct,
    url: sqlActor.id,
    // The ActivityPub actor id. This service uses the actor id as the profile
    // URL too, so `uri` and `url` carry the same value.
    uri: sqlActor.id,
    display_name: sqlActor.name ?? '',
    note,

    avatar: settings.iconUrl ?? '',
    avatar_static: settings.iconUrl ?? '',
    header: settings.headerImageUrl ?? '',
    header_static: settings.headerImageUrl ?? '',
    // Mastodon 4.6 avatar/header alt text. Empty string when unset, matching
    // Mastodon's serialization (and the Profile entity in lib/services/accounts).
    avatar_description: settings.avatarDescription ?? '',
    header_description: settings.headerDescription ?? '',

    fields: profileFields,
    emojis: getAccountEmojisFromTags(settings.tags),

    // Moderation flags: emitted only when set, matching Mastodon's Account
    // entity (extra "only when suspended/silenced" attributes).
    ...(sqlActor.suspendedAt != null ? { suspended: true } : null),
    ...(sqlActor.silencedAt != null ? { limited: true } : null),

    locked: settings.manuallyApprovesFollowers ?? true,
    bot: isMastodonBotActorType(sqlActor.type) || settings.bot === true,
    group: sqlActor.type === 'Group',
    discoverable: settings.discoverable ?? !isLocalHeadlessSigner,
    noindex: isLocalHeadlessSigner,
    // No roles system: every account serializes an empty public role list (the
    // credential endpoints still overlay the singular default `role`).
    roles: [],
    // Mastodon's opt-in full-text-search flag; false by default like Mastodon.
    indexable: settings.indexable ?? false,
    hide_collections: settings.hideCollections ?? null,

    // `source.note` is the plain-text bio and `source.fields` mirror the public
    // fields. The default privacy/sensitive/language come from the account's
    // saved posting preferences. follow_requests_count is left at 0 here so the
    // public Account never leaks it; the credential endpoints overlay the real
    // count (see lib/services/accounts/credentialAccount).
    source: {
      note: sourceNote,
      fields: sourceFields,
      privacy: settings.defaultPrivacy ?? 'public',
      sensitive: settings.defaultSensitive ?? false,
      language: settings.defaultLanguage ?? 'en',
      quote_policy: settings.defaultQuotePolicy ?? 'public',
      attribution_domains: settings.attributionDomains ?? [],
      follow_requests_count: 0
    },

    created_at: getISOTimeUTC(getCompatibleTime(sqlActor.createdAt)),
    last_status_at:
      lastStatusAt != null ? getISOTimeUTC(lastStatusAt, true) : null,

    followers_count: counters.followersCount,
    following_count: counters.followingCount,
    statuses_count: counters.statusCount,
    ...(moved ? { moved } : null)
  })
}
