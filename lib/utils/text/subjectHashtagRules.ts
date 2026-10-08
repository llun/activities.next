// The one rule that turns a subject name into a hashtag. Pure (no server
// imports) so the server, which appends the tags to a post, and the client,
// which shows the same tags, can never disagree.
import { HASHTAG_REGEX } from '@/lib/utils/text/getHashtags'

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
 * "Alcedo atthis" -> "AlcedoAtthis". Only a binomial gets a tag: the first two
 * words of the scientific name (so "Alcedo atthis bengalensis" and "Alcedo
 * atthis (Linnaeus, 1758)" both tag the species) must each be plain letters.
 * A genus alone, a hybrid mark ("Quercus × rosacea") or "sp." gets none.
 */
export const toScientificHashtag = (scientificName: string): string | null => {
  const words = scientificName.trim().split(/\s+/)
  if (words.length < 2) return null
  const [genus, epithet] = words
  if (!/^[A-Z][a-z]+$/.test(genus)) return null
  if (!/^[a-z][a-z-]*$/.test(epithet) || epithet === 'sp') return null
  return toSubjectHashtag(`${genus} ${epithet}`)
}
