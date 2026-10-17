// Writing actors: creation, profile and settings updates, removal of the row,
// and the deletion state. Every write that changes what account search shows
// re-indexes the actor's search document in the same transaction.
import {
  getActorFromId,
  getNotificationPolicy
} from '@/lib/database/domains/actor/lookups'
import {
  asSQLActor,
  getConfiguredActorDomain
} from '@/lib/database/domains/actor/rows'
import type {
  CancelActorDeletionParams,
  CreateActorParams,
  DeleteActorParams,
  MarkActorProfileFieldsVerifiedParams,
  ScheduleActorDeletionParams,
  StartActorDeletionParams,
  UpdateActorParams
} from '@/lib/database/domains/actor/types'
import {
  deleteActorSearchDocument,
  indexActorSearchDocument
} from '@/lib/database/domains/search/accounts'
import { type Db, inTransaction } from '@/lib/database/kysely'
import { forUpdate } from '@/lib/database/kysely/dialect'
import { getCompatibleJSON } from '@/lib/database/utils/getCompatibleJSON'
import type {
  NotificationPolicy,
  UpdateNotificationPolicyParams
} from '@/lib/types/database/operations'
import type { ActorSettings } from '@/lib/types/database/rows'
import type { Actor } from '@/lib/types/domain/actor'
import { carryOverFieldVerification } from '@/lib/utils/profileFieldVerification'
import { generatePublicId } from '@/lib/utils/publicId'
import { getEmojiTags } from '@/lib/utils/text/getEmojiTags'

type EmojiTag = { type: 'emoji'; name: string; value: string }

// The enabled custom emojis named in `text`, as actor tags.
const resolveLocalEmojiTags = async (
  db: Db,
  text: string
): Promise<EmojiTag[]> => {
  if (!text) return []
  const rows = await db
    .selectFrom('customEmojis')
    .select(['shortcode', 'url'])
    .where('disabled', '=', false)
    .execute()
  return getEmojiTags(text, rows).map((tag) => ({
    type: 'emoji' as const,
    name: tag.name,
    value: tag.value
  }))
}

const isConfiguredDomain = (domain: string) =>
  domain.toLowerCase() === getConfiguredActorDomain().toLowerCase()

const getFieldsText = (fields: { name: string; value: string }[]) =>
  fields.map((field) => `${field.name} ${field.value}`).join(' ')

export const createActor = async (
  db: Db,
  {
    actorId,
    type = 'Person',
    username,
    domain,
    name,
    summary,
    iconUrl,
    headerImageUrl,
    manuallyApprovesFollowers,
    fields,
    tags,
    followersUrl,
    inboxUrl,
    sharedInboxUrl,
    publicKey,
    privateKey,
    createdAt
  }: CreateActorParams
): Promise<Actor | null> => {
  const currentTime = new Date()
  // A local actor's emoji tags are resolved from its profile text unless the
  // caller passes them.
  const resolvedTags =
    tags === undefined &&
    (name || summary || fields) &&
    isConfiguredDomain(domain)
      ? await resolveLocalEmojiTags(
          db,
          `${name ?? ''} ${summary ?? ''} ${getFieldsText(fields ?? [])}`.trim()
        )
      : tags

  const settings: ActorSettings = {
    iconUrl,
    headerImageUrl,
    followersUrl,
    inboxUrl,
    sharedInboxUrl,
    ...(manuallyApprovesFollowers !== undefined
      ? { manuallyApprovesFollowers }
      : null),
    ...(fields !== undefined ? { fields } : null),
    ...(resolvedTags && resolvedTags.length > 0 ? { tags: resolvedTags } : null)
  }
  const actor = {
    id: actorId,
    publicId: generatePublicId(createdAt),
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

  await inTransaction(db, async (trx) => {
    await trx.insertInto('actors').values(actor).execute()
    await indexActorSearchDocument(trx, { id: actorId, actor })
  })
  return getActorFromId(db, { id: actorId })
}

export const updateActor = async (
  db: Db,
  {
    actorId,
    type,
    name,
    summary,
    iconUrl,
    headerImageUrl,
    manuallyApprovesFollowers,
    fields,
    tags,
    bot,
    discoverable,
    indexable,
    hideCollections,
    attributionDomains,
    defaultPrivacy,
    defaultSensitive,
    defaultLanguage,
    defaultQuotePolicy,
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
    avatarDescription,
    headerDescription,
    showMedia,
    showMediaReplies,
    showFeatured,
    navOrder,
    navHidden,

    publicKey,

    followersUrl,
    inboxUrl,
    sharedInboxUrl
  }: UpdateActorParams
): Promise<Actor | null> => {
  const row = await db
    .selectFrom('actors')
    .selectAll()
    .where('id', '=', actorId)
    .limit(1)
    .executeTakeFirst()
  if (!row) return null
  const persistedActor = asSQLActor(row)

  const persistedSettings = getCompatibleJSON<ActorSettings>(
    persistedActor.settings
  )
  // A local actor's emoji tags follow its profile text: re-resolved from the
  // updated name, summary and fields unless the caller passes tags.
  let resolvedTags = tags
  if (
    tags === undefined &&
    (name !== undefined || summary !== undefined || fields !== undefined) &&
    isConfiguredDomain(persistedActor.domain)
  ) {
    const targetName = name !== undefined ? name : (persistedActor.name ?? '')
    const targetSummary =
      summary !== undefined ? summary : (persistedActor.summary ?? '')
    const targetFields =
      fields !== undefined ? fields : (persistedSettings.fields ?? [])
    resolvedTags = await resolveLocalEmojiTags(
      db,
      `${targetName} ${targetSummary} ${getFieldsText(targetFields)}`.trim()
    )
  }
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
    ...(fields !== undefined
      ? {
          fields: carryOverFieldVerification(fields, persistedSettings.fields)
        }
      : null),
    ...(resolvedTags !== undefined ? { tags: resolvedTags } : null),
    ...(bot !== undefined ? { bot } : null),
    ...(discoverable !== undefined ? { discoverable } : null),
    ...(indexable !== undefined ? { indexable } : null),
    ...(hideCollections !== undefined ? { hideCollections } : null),
    ...(attributionDomains !== undefined ? { attributionDomains } : null),
    ...(defaultPrivacy !== undefined ? { defaultPrivacy } : null),
    ...(defaultSensitive !== undefined ? { defaultSensitive } : null),
    ...(defaultLanguage !== undefined ? { defaultLanguage } : null),
    ...(defaultQuotePolicy !== undefined ? { defaultQuotePolicy } : null),
    ...(postLineLimit !== undefined ? { postLineLimit } : null),
    ...(readingExpandMedia !== undefined ? { readingExpandMedia } : null),
    ...(readingExpandSpoilers !== undefined ? { readingExpandSpoilers } : null),
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
    ...(avatarDescription !== undefined ? { avatarDescription } : null),
    ...(headerDescription !== undefined ? { headerDescription } : null),
    ...(showMedia !== undefined ? { showMedia } : null),
    ...(showMediaReplies !== undefined ? { showMediaReplies } : null),
    ...(showFeatured !== undefined ? { showFeatured } : null),
    ...(navOrder !== undefined ? { navOrder } : null),
    ...(navHidden !== undefined ? { navHidden } : null),

    ...(followersUrl ? { followersUrl } : null),
    ...(inboxUrl ? { inboxUrl } : null),
    ...(sharedInboxUrl ? { sharedInboxUrl } : null)
  }
  // A null iconUrl/headerImageUrl means "explicitly clear this field"
  // (distinct from undefined = "no change"). ActorSettings types these as
  // optional strings, so the key is dropped rather than stored as null, the
  // same way on every derived settings object.
  const applyExplicitClears = (target: ActorSettings): ActorSettings => {
    if (iconUrl === null) delete target.iconUrl
    if (headerImageUrl === null) delete target.headerImageUrl
    return target
  }

  const currentTime = new Date()
  const columnUpdates = {
    ...(type ? { type } : null),
    ...(name ? { name } : null),
    ...(summary ? { summary } : null),
    ...(publicKey ? { publicKey } : null)
  }

  await inTransaction(db, async (trx) => {
    let settings = applyExplicitClears({
      ...persistedSettings,
      ...settingsUpdates
    })

    if (appendNotificationAcceptedSenders !== undefined) {
      // Re-read inside the transaction (with a row lock on PostgreSQL) to
      // merge accepted senders atomically and avoid lost-update races.
      const freshActor = await forUpdate(
        trx,
        trx
          .selectFrom('actors')
          .select('settings')
          .where('id', '=', actorId)
          .limit(1)
      ).executeTakeFirst()
      if (freshActor) {
        const freshSettings = getCompatibleJSON<ActorSettings>(
          freshActor.settings as string | ActorSettings
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
        settings = applyExplicitClears({
          ...freshSettings,
          ...settingsUpdates,
          notificationAcceptedSenders: [...existing, ...toAdd]
        })
      }
    }

    await trx
      .updateTable('actors')
      .set({
        ...columnUpdates,
        settings: JSON.stringify(settings),
        updatedAt: currentTime
      })
      .where('id', '=', actorId)
      .execute()
    await indexActorSearchDocument(trx, {
      id: actorId,
      actor: {
        ...persistedActor,
        ...columnUpdates,
        settings: JSON.stringify(settings)
      }
    })
  })
  return getActorFromId(db, { id: actorId })
}

// Stamps `verifiedAt` on the stored profile fields whose value is one of
// `values`, the values the verification job checked. The row is re-read under
// a lock and only fields that still hold such a value and are not verified yet
// change, so a profile edited while the job ran keeps its newer fields as they
// are. Only the settings JSON is written: `updatedAt` is the remote refresh
// clock and the profile text did not change, so neither moves.
export const markActorProfileFieldsVerified = async (
  db: Db,
  { actorId, values, verifiedAt }: MarkActorProfileFieldsVerifiedParams
): Promise<void> => {
  await inTransaction(db, async (trx) => {
    const row = await forUpdate(
      trx,
      trx
        .selectFrom('actors')
        .select('settings')
        .where('id', '=', actorId)
        .limit(1)
    ).executeTakeFirst()
    if (!row) return
    const settings = getCompatibleJSON<ActorSettings>(
      row.settings as string | ActorSettings
    )
    const checked = new Set(values)
    let changed = false
    const fields = (settings.fields ?? []).map((field) => {
      if (field.verifiedAt || !checked.has(field.value)) return field
      changed = true
      return { ...field, verifiedAt }
    })
    if (!changed) return
    await trx
      .updateTable('actors')
      .set({ settings: JSON.stringify({ ...settings, fields }) })
      .where('id', '=', actorId)
      .execute()
  })
}

export const updateNotificationPolicy = async (
  db: Db,
  { actorId, ...partial }: UpdateNotificationPolicyParams
): Promise<NotificationPolicy> => {
  const current = await getNotificationPolicy(db, { actorId })
  const notificationPolicy: NotificationPolicy = { ...current, ...partial }
  await updateActor(db, { actorId, notificationPolicy })
  return notificationPolicy
}

export const deleteActor = async (
  db: Db,
  { actorId }: DeleteActorParams
): Promise<void> => {
  await inTransaction(db, async (trx) => {
    await trx.deleteFrom('actors').where('id', '=', actorId).execute()
    await deleteActorSearchDocument(trx, { id: actorId })
  })
}

// Sets the deletion columns and re-indexes the actor, whose search document
// leaves the index while a deletion is pending.
const setDeletionState = (
  db: Db,
  actorId: string,
  values: {
    deletionStatus: 'scheduled' | 'deleting' | null
    deletionScheduledAt?: Date | null
  }
) =>
  inTransaction(db, async (trx) => {
    await trx
      .updateTable('actors')
      .set({ ...values, updatedAt: new Date() })
      .where('id', '=', actorId)
      .execute()
    await indexActorSearchDocument(trx, { id: actorId })
  })

export const scheduleActorDeletion = (
  db: Db,
  { actorId, scheduledAt }: ScheduleActorDeletionParams
): Promise<void> =>
  setDeletionState(db, actorId, {
    deletionStatus: 'scheduled',
    deletionScheduledAt: scheduledAt
  })

export const cancelActorDeletion = (
  db: Db,
  { actorId }: CancelActorDeletionParams
): Promise<void> =>
  setDeletionState(db, actorId, {
    deletionStatus: null,
    deletionScheduledAt: null
  })

export const startActorDeletion = (
  db: Db,
  { actorId }: StartActorDeletionParams
): Promise<void> =>
  setDeletionState(db, actorId, { deletionStatus: 'deleting' })
