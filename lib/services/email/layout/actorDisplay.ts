import { ActorProfile, getMention } from '@/lib/types/domain/actor'
import { getHashFromString } from '@/lib/utils/getHashFromString'

import { MONOGRAM_PALETTE } from './theme'

/** The two strings the quoted-actor row in an email renders. */
export interface QuoteAuthor {
  readonly displayName: string
  readonly handle: string
}

type NamedActor = Pick<ActorProfile, 'name' | 'username'>

const getWords = (value: string) => value.trim().split(/\s+/).filter(Boolean)

/** Full display name: the profile name when set, otherwise the bare username. */
export const getDisplayName = (actor: NamedActor): string =>
  actor.name?.trim() || actor.username

/**
 * The short form used in headlines — "Ben Carter" becomes "Ben", so a subject
 * line reads "Ben boosted your post" rather than restating the whole name.
 */
export const getShortName = (actor: NamedActor): string => {
  const displayName = getDisplayName(actor)
  return getWords(displayName)[0] ?? displayName
}

/**
 * Two-letter monogram for the avatar circle: initials of the first two words
 * ("Ben Carter" -> "BC"), or the first two characters of a single-word name
 * ("Maythee" -> "MA").
 *
 * This deliberately differs from the web `Avatar` component, which emits a
 * single letter for a one-word name. The email circle is a fixed 24px with no
 * image fallback, and one letter reads as a typo at that size.
 *
 * Iterates with `Array.from` so an astral-plane first character (emoji, many
 * CJK extensions) is taken whole instead of being split at a surrogate pair.
 */
export const getInitials = (displayName: string): string => {
  const words = getWords(displayName)
  if (words.length === 0) return '?'
  if (words.length === 1) {
    return Array.from(words[0]).slice(0, 2).join('').toUpperCase()
  }
  return words
    .slice(0, 2)
    .map((word) => Array.from(word)[0])
    .join('')
    .toUpperCase()
}

/**
 * Deterministic monogram fill, keyed on the full `@user@domain` handle so the
 * same person is the same colour in every email they appear in.
 */
export const getMonogramColor = (handle: string): string => {
  // Slice 8 hex chars (max 0xffffffff) so the parse stays inside a safe integer.
  const index =
    parseInt(getHashFromString(handle).slice(0, 8), 16) %
    MONOGRAM_PALETTE.length
  return MONOGRAM_PALETTE[index]
}

export const toQuoteAuthor = (actor: ActorProfile): QuoteAuthor => ({
  displayName: getDisplayName(actor),
  handle: getMention(actor, true)
})
