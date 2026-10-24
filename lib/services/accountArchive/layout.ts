import path from 'path'

import { ARCHIVE_EXTRAS_DIR } from './constants'

/** One actor of the account as the archive plans it. */
export interface ArchiveActorPlan {
  id: string
  username: string
  domain: string
  isDefault: boolean
  /**
   * Where this actor's Mastodon-shaped files (actor.json, outbox.json, ...)
   * live: '' (the archive root) for the default profile, the actor directory
   * for every other profile.
   */
  mastodonDir: string
  /** Where this actor's extras (profile.json, statuses.jsonl, ...) live. */
  dir: string
}

const SEGMENT_UNSAFE = /[^A-Za-z0-9._@-]/g

/** A path segment made of a username or domain (a port's colon becomes `_`). */
export const toSafeSegment = (value: string): string => {
  const cleaned = value.replace(SEGMENT_UNSAFE, '_').replace(/^\.+/, '_')
  return cleaned.length > 0 ? cleaned : '_'
}

/**
 * Lays out the account's actors: the default profile first, then the others in
 * the order given. Two actors that would share a directory (`a.b` and `a_b`
 * both clean to the same segment) get a numeric suffix.
 */
export const planArchiveActors = (
  actors: { id: string; username: string; domain: string }[],
  defaultActorId: string | null
): ArchiveActorPlan[] => {
  const defaultActor =
    actors.find((actor) => actor.id === defaultActorId) ?? actors[0]
  const ordered = defaultActor
    ? [defaultActor, ...actors.filter((actor) => actor.id !== defaultActor.id)]
    : []

  const used = new Set<string>()
  return ordered.map((actor) => {
    const base = `${ARCHIVE_EXTRAS_DIR}/actors/${toSafeSegment(actor.domain)}/${toSafeSegment(actor.username)}`
    let dir = base
    for (let suffix = 2; used.has(dir.toLowerCase()); suffix += 1) {
      dir = `${base}-${suffix}`
    }
    used.add(dir.toLowerCase())
    const isDefault = actor.id === defaultActor.id
    return {
      id: actor.id,
      username: actor.username,
      domain: actor.domain,
      isDefault,
      mastodonDir: isDefault ? '' : dir,
      dir
    }
  })
}

/** Joins zip entry segments, skipping empty ones. */
export const entryPath = (...segments: string[]) =>
  segments.filter((segment) => segment.length > 0).join('/')

/**
 * A zip entry name for `value`, or null when it is not a plain relative path.
 * Storage paths come from database rows, so one with `..`, an absolute path or
 * a backslash must not become an entry that extracts outside its folder.
 */
export const toSafeEntryName = (value: string): string | null => {
  if (!value || value.includes('\\') || value.includes('\0')) return null
  if (path.posix.isAbsolute(value)) return null
  const segments = value.split('/')
  if (segments.some((segment) => segment === '' || segment === '..')) {
    return null
  }
  return segments.filter((segment) => segment !== '.').join('/')
}
