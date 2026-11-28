import sharp from 'sharp'

import type { Database } from '@/lib/database/types'
import {
  cutToRoom,
  fitImageForBluesky,
  pollHtmlToBlueskyPlainText
} from '@/lib/services/bluesky/crosspostText'
import { getServedHostConfig } from '@/lib/services/domains/servedDomainSnapshot'
import { getMediaPathFromFileUrl } from '@/lib/services/medias/mediaFileUrl'
import { readStoredImage } from '@/lib/services/medias/readStoredMedia'
import type { Actor } from '@/lib/types/domain/actor'
import {
  countBlueskyGraphemes,
  countBlueskyUtf8Bytes
} from '@/lib/utils/blueskyText'
import { getActorProfileUrl } from '@/lib/utils/getPersonFromActor'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import { uploadPdsBlob } from './blobs'
import { resolveEffectivePdsRepoStatus } from './effectiveStatus'
import { getMovedToHost } from './moved'
import { enqueueHostedBlueskyProfileSync } from './profileQueue'
import { getPdsRecordValue } from './reads'
import { putPdsRecord } from './repo'

// The `app.bsky.actor.profile` record of a hosted account, kept in step with
// the actor's own profile: the display name, the bio as plain text with a link
// back to the fediverse profile, and the avatar and banner as blobs in the
// hosted repo.

export const HOSTED_PROFILE_COLLECTION = 'app.bsky.actor.profile'
export const HOSTED_PROFILE_RKEY = 'self'

// The lexicon's limits: `maxGraphemes` and `maxLength` (UTF-8 bytes).
const DISPLAY_NAME_MAX_GRAPHEMES = 64
const DISPLAY_NAME_MAX_BYTES = 640
const DESCRIPTION_MAX_GRAPHEMES = 256
const DESCRIPTION_MAX_BYTES = 2560

// A settings card load re-enqueues the backfill at most once an hour, so a
// reload does not pile up jobs while a failed one still retries later.
const BACKFILL_DEDUPE_WINDOW_MS = 60 * 60 * 1000

export type HostedProfileImage = {
  $type: 'blob'
  ref: unknown
  mimeType: string
  size: number
}

const fitDescription = (bio: string, profileUrl: string): string => {
  const link = `\n\n${profileUrl}`
  const full = bio ? `${bio}${link}` : profileUrl
  if (
    countBlueskyGraphemes(full) <= DESCRIPTION_MAX_GRAPHEMES &&
    countBlueskyUtf8Bytes(full) <= DESCRIPTION_MAX_BYTES
  ) {
    return full
  }
  const room = DESCRIPTION_MAX_GRAPHEMES - countBlueskyGraphemes(link)
  const byteRoom = DESCRIPTION_MAX_BYTES - countBlueskyUtf8Bytes(link)
  const cut = cutToRoom(bio, Math.max(0, room), Math.max(0, byteRoom))
  return cut ? `${cut}${link}` : profileUrl
}

/**
 * The `app.bsky.actor.profile` record for `actor`: the display name cut to the
 * lexicon's 64 graphemes / 640 bytes, the bio as plain text followed by a blank
 * line and the profile URL (cut to 256 graphemes / 2560 bytes, keeping the
 * link), and the avatar and banner blobs when there are any.
 */
export const buildHostedBlueskyProfileRecord = ({
  actor,
  profileUrl,
  avatar,
  banner
}: {
  actor: Pick<Actor, 'name' | 'summary'>
  profileUrl: string
  avatar?: HostedProfileImage | null
  banner?: HostedProfileImage | null
}): Record<string, unknown> => {
  const name = actor.name?.trim()
  const displayName = name
    ? cutToRoom(name, DISPLAY_NAME_MAX_GRAPHEMES, DISPLAY_NAME_MAX_BYTES)
    : ''
  const bio = actor.summary ? pollHtmlToBlueskyPlainText(actor.summary) : ''
  const description = fitDescription(bio, profileUrl)

  return {
    $type: HOSTED_PROFILE_COLLECTION,
    ...(displayName ? { displayName } : null),
    ...(description ? { description } : null),
    ...(avatar ? { avatar } : null),
    ...(banner ? { banner } : null)
  }
}

// The image bytes are read the way the cross-post code reads media: only a URL
// this instance serves its own media from, only a file the account owns, and
// only through the storage driver. A remote URL is never fetched.
const uploadProfileImage = async (
  database: Database,
  actor: Actor,
  did: string,
  url: string
): Promise<HostedProfileImage | null> => {
  const accountId = actor.account?.id
  if (!accountId) return null
  const path = getMediaPathFromFileUrl(url, getServedHostConfig())
  if (!path) return null
  if (!(await database.ownsAccountExportMediaPath({ accountId, path }))) {
    return null
  }
  const stored = await readStoredImage(database, path)
  if (!stored) return null
  const fitted = await fitImageForBluesky(stored.buffer)
  // The lexicon accepts only PNG and JPEG for avatar and banner.
  const image =
    fitted.mimeType === 'image/webp'
      ? {
          bytes: await sharp(fitted.bytes)
            .flatten({ background: '#ffffff' })
            .jpeg({ quality: 90 })
            .toBuffer(),
          mimeType: 'image/jpeg'
        }
      : { bytes: fitted.bytes, mimeType: fitted.mimeType }
  const uploaded = await uploadPdsBlob(database, {
    did,
    bytes: image.bytes,
    mimeType: image.mimeType
  })
  return uploaded.blob
}

const resolveProfileImage = async (
  database: Database,
  actor: Actor,
  did: string,
  url: string | undefined,
  existing: unknown
): Promise<HostedProfileImage | null> => {
  if (!url) return null
  try {
    return (
      (await uploadProfileImage(database, actor, did, url)) ??
      (existing as HostedProfileImage | null) ??
      null
    )
  } catch (error) {
    logger.warn({
      message: 'Could not sync a hosted Bluesky profile image',
      actorId: actor.id,
      err: toLoggableError(error)
    })
    return (existing as HostedProfileImage | null) ?? null
  }
}

/**
 * Writes the actor's `app.bsky.actor.profile/self` record into its hosted repo,
 * or does nothing when the repo is not active (suspended, deactivated, taken
 * down, moved out or deleted) or the record would be unchanged. `putPdsRecord`
 * compares the record's CID, so an unchanged profile commits nothing.
 */
export const syncHostedBlueskyProfile = async (
  database: Database,
  actorId: string
): Promise<void> => {
  const actor = await database.getActorFromId({ id: actorId })
  if (!actor) return
  const repo = await database.getPdsRepo({ actorId })
  if (!repo || repo.status === 'deleted') return
  if (getMovedToHost(repo)) return
  if (resolveEffectivePdsRepoStatus(repo, actor) !== 'active') return

  const existing = await getPdsRecordValue(database, {
    did: repo.did,
    collection: HOSTED_PROFILE_COLLECTION,
    rkey: HOSTED_PROFILE_RKEY
  })
  const current = existing?.value ?? {}
  const [avatar, banner] = await Promise.all([
    resolveProfileImage(
      database,
      actor,
      repo.did,
      actor.iconUrl,
      current.avatar
    ),
    resolveProfileImage(
      database,
      actor,
      repo.did,
      actor.headerImageUrl,
      current.banner
    )
  ])

  await putPdsRecord(database, {
    did: repo.did,
    collection: HOSTED_PROFILE_COLLECTION,
    rkey: HOSTED_PROFILE_RKEY,
    record: buildHostedBlueskyProfileRecord({
      actor,
      profileUrl: getActorProfileUrl(actor),
      avatar,
      banner
    })
  })
}

/**
 * The self-healing backfill: when a hosted account has no profile record yet,
 * queue the sync. Called when the hosted account card loads in Settings, so an
 * account created before this record existed (or whose creation write failed)
 * repairs itself the next time its owner looks at it.
 */
export const backfillHostedBlueskyProfile = async (
  database: Database,
  actor: Actor
): Promise<void> => {
  try {
    const repo = await database.getPdsRepo({ actorId: actor.id })
    if (!repo || repo.status === 'deleted') return
    if (getMovedToHost(repo)) return
    if (resolveEffectivePdsRepoStatus(repo, actor) !== 'active') return
    const existing = await database.getPdsRecord({
      did: repo.did,
      collection: HOSTED_PROFILE_COLLECTION,
      rkey: HOSTED_PROFILE_RKEY
    })
    if (existing) return
    await enqueueHostedBlueskyProfileSync({
      actorId: actor.id,
      dedupeWindowMs: BACKFILL_DEDUPE_WINDOW_MS
    })
  } catch (error) {
    logger.warn({
      message: 'Could not check the hosted Bluesky profile backfill',
      actorId: actor.id,
      err: toLoggableError(error)
    })
  }
}
