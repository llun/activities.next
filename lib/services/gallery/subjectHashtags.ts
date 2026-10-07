import { Database } from '@/lib/database/types'
import { getGallerySettingsOrDefaults } from '@/lib/services/gallery/uploadMediaDetails'
import { logger } from '@/lib/utils/logger'
import { HASHTAG_REGEX, getHashtags } from '@/lib/utils/text/getHashtags'
import { toLoggableError } from '@/lib/utils/toLoggableError'

// A hashtag longer than this is a sentence, not a tag.
const MAX_HASHTAG_LENGTH = 100

/**
 * "Common Kingfisher" -> "CommonKingfisher"; "Eurasian Eagle-Owl" ->
 * "EurasianEagleOwl"; "Côte d'Ivoire" -> "CoteDIvoire". Diacritics are
 * stripped because the hashtag grammar this server extracts
 * (`HASHTAG_REGEX`) is ASCII-only. Returns null for a name with no usable
 * letter in it (a name written in a script the grammar does not cover), which
 * gets no hashtag rather than a broken one.
 */
export const toSubjectHashtag = (subjectName: string): string | null => {
  const words = subjectName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
  const tag = words
    .map((word) => {
      const rest = word.slice(1)
      // Leave "McCown" alone, but tame an all-caps "KINGFISHER".
      const tamedRest = rest === rest.toUpperCase() ? rest.toLowerCase() : rest
      return word.charAt(0).toUpperCase() + tamedRest
    })
    .join('')
    .slice(0, MAX_HASHTAG_LENGTH)

  // The same test the extractor applies: at least one letter or underscore.
  return new RegExp(HASHTAG_REGEX.source).test(` #${tag}`) ? tag : null
}

/**
 * Appends a `#PascalCase` hashtag to a post's text for each attached media that
 * has a subject name, when the author's `subjectHashtags` setting is on and the
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
  text,
  mediaIds
}: {
  database: Database
  accountId: string | undefined
  text: string
  mediaIds: string[]
}): Promise<string> => {
  if (!accountId || mediaIds.length === 0) return text

  try {
    // The actor id is the settings key, but settings are per author and the
    // medias are looked up by account; resolve through the media owner below.
    const medias = await database.getMediaByIdsForAccount({
      mediaIds,
      accountId
    })
    const subjectMedias = medias.filter((media) =>
      Boolean(media.details?.subjectName)
    )
    if (subjectMedias.length === 0) return text

    const settings = await getGallerySettingsOrDefaults(
      database,
      subjectMedias[0].actorId
    )
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
    for (const media of orderedMedias) {
      const tag = toSubjectHashtag(media.details?.subjectName ?? '')
      if (!tag || present.has(tag.toLowerCase())) continue
      present.add(tag.toLowerCase())
      additions.push(`#${tag}`)
    }
    if (additions.length === 0) return text

    const trimmed = text.trimEnd()
    return trimmed
      ? `${trimmed}\n\n${additions.join(' ')}`
      : additions.join(' ')
  } catch (error) {
    logger.warn({
      message: 'Failed to append subject hashtags to a post',
      err: toLoggableError(error)
    })
    return text
  }
}
