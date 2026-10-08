import { Database } from '@/lib/database/types'
import { getGallerySettingsOrDefaults } from '@/lib/services/gallery/uploadMediaDetails'
import { logger } from '@/lib/utils/logger'
import { getHashtags } from '@/lib/utils/text/getHashtags'
import {
  toScientificHashtag,
  toSubjectHashtag
} from '@/lib/utils/text/subjectHashtagRules'
import { toLoggableError } from '@/lib/utils/toLoggableError'

// Re-exported so server callers keep one import; the rules live in a pure
// module the client components share.
export { toScientificHashtag, toSubjectHashtag }

/**
 * Appends a `#PascalCase` hashtag to a post's text for each attached media that
 * has a subject name, and a `#GenusSpecies` one beside it when the subject has a
 * scientific name (`#CommonKingfisher #AlcedoAtthis`), when the author's `subjectHashtags` setting is on and the
 * text does not already carry that tag (compared case-insensitively, the way
 * hashtags are everywhere else).
 *
 * It runs BEFORE the text is stored and before `getHashtags` extracts the
 * post's tags, so the appended tags are indistinguishable from ones the author
 * typed: they are rendered, federated and counted like them.
 *
 * Never throws: a lookup failure leaves the text as the author wrote it.
 */
export const appendSubjectHashtags = async ({
  database,
  accountId,
  actorId,
  text,
  mediaIds,
  maxCharacters
}: {
  database: Database
  accountId: string | undefined
  /** The post's author: whose `subjectHashtags` setting applies. */
  actorId: string
  text: string
  mediaIds: string[]
  /**
   * The instance's `posts.maxCharacters`. The caller has already validated the
   * author's text against it, so appended tags must not push the post over:
   * once the next tag would, it and the rest are skipped. Lengths are counted
   * with `String.length`, the way `validateStatusContentLimits` does. Omit for
   * no limit.
   */
  maxCharacters?: number
}): Promise<string> => {
  if (!accountId || mediaIds.length === 0) return text

  try {
    // Medias are looked up by account, but the `subjectHashtags` setting is
    // the post author's (`actorId`), not that of whichever actor owns the
    // media rows.
    const medias = await database.getMediaByIdsForAccount({
      mediaIds,
      accountId
    })
    const subjectMedias = medias.filter((media) =>
      Boolean(
        media.details?.subjectName || media.details?.subjectScientificName
      )
    )
    if (subjectMedias.length === 0) return text

    const settings = await getGallerySettingsOrDefaults(database, actorId)
    if (!settings.subjectHashtags) return text

    const present = new Set(
      getHashtags(text, 'unused').map((hashtag) =>
        hashtag.name.slice(1).toLowerCase()
      )
    )
    const additions: string[] = []
    // Attachment order, not database order, so tags read in the order the
    // photos are shown.
    const orderedMedias = [...subjectMedias].sort(
      (a, b) => mediaIds.indexOf(a.id) - mediaIds.indexOf(b.id)
    )
    const trimmed = text.trimEnd()
    // Joiner before the first tag: a blank line after text, nothing otherwise.
    const separator = trimmed ? '\n\n' : ''
    let length = trimmed.length
    // The common-name tag first, then the scientific one, per photo.
    const tags = orderedMedias.flatMap((media) => [
      toSubjectHashtag(media.details?.subjectName ?? ''),
      toScientificHashtag(media.details?.subjectScientificName ?? '')
    ])
    for (const tag of tags) {
      if (!tag || present.has(tag.toLowerCase())) continue
      const addition = `#${tag}`
      if (maxCharacters !== undefined) {
        const cost =
          additions.length === 0
            ? separator.length + addition.length
            : 1 + addition.length
        // Stop at the first tag that does not fit, so tags stay in photo order.
        if (length + cost > maxCharacters) break
        length += cost
      }
      present.add(tag.toLowerCase())
      additions.push(addition)
    }
    if (additions.length === 0) return text

    return `${trimmed}${separator}${additions.join(' ')}`
  } catch (error) {
    logger.warn({
      message: 'Failed to append subject hashtags to a post',
      err: toLoggableError(error)
    })
    return text
  }
}
