import { BaseNote, getTags } from '@/lib/activities/note'
import { Database } from '@/lib/database/types'
import { isHttpUrl } from '@/lib/utils/isHttpUrl'
import { logger } from '@/lib/utils/logger'

// Postgres `tags.name` and `tags.value` are varchar(255).
const MAX_TAG_FIELD_LENGTH = 255

// Port of Mastodon's Tag::HASHTAG_NAME_RE and HASHTAG_INVALID_CHARS_RE
// (app/models/tag.rb). In Onigmo [[:alpha:]] is \p{Alphabetic}, [[:alnum:]] is
// \p{Alphabetic}\p{Nd} and [[:word:]] is \p{Alphabetic}\p{M}\p{Nd}\p{Pc}.
const WORD = '\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}'
// HASHTAG_SEPARATORS: underscore, middle dot, katakana middle dot, ZWNJ.
const SEPARATORS = '_\\u00B7\\u30FB\\u200C'
// HASHTAG_INVALID_CHARS_RE: [^[:alnum:]\u0E47-\u0E4E SEPARATORS]. Marks other
// than the Thai ones are stripped (a decomposed `café` becomes `cafe`), as
// Mastodon does.
const HASHTAG_INVALID_CHARS_RE = new RegExp(
  `[^\\p{Alphabetic}\\p{Nd}\\u0E47-\\u0E4E${SEPARATORS}]`,
  'gu'
)

// Per-character classes; each is a single non-backtracking class.
const WORD_CHAR = new RegExp(`^[${WORD}]$`, 'u')
const SEPARATOR_CHAR = new RegExp(`^[${SEPARATORS}]$`, 'u')
const ALPHABETIC_CHAR = /^\p{Alphabetic}$/u

const IS_WORD = 1
const IS_SEPARATOR = 2
const IS_ALPHABETIC = 4

const classCache = new Map<string, number>()
const classify = (char: string): number => {
  const cached = classCache.get(char)
  if (cached !== undefined) return cached
  const flags =
    (WORD_CHAR.test(char) ? IS_WORD : 0) |
    (SEPARATOR_CHAR.test(char) ? IS_SEPARATOR : 0) |
    (ALPHABETIC_CHAR.test(char) ? IS_ALPHABETIC : 0)
  // Bounded, so names full of distinct characters cannot grow it.
  if (classCache.size < 4096) classCache.set(char, flags)
  return flags
}

// Mastodon's HASHTAG_NAME_RE is /\A(FIRST|LAST)\z/i with
//   FIRST = [W_][WS]*[A S][WS]*[W_]   LAST = [W_]*[A][W_]*
// where W is word, S a separator and A alphabetic ('_' is both). Run as a
// regex the overlapping classes backtrack quadratically on a 255 character
// name, so this is the equivalent single pass. Every character must be a word
// character or separator, and then either
//  - every character is a word character and one is alphabetic (LAST), or
//  - the name has 3+ characters, starts and ends with a word character and an
//    inner character is alphabetic or a separator (FIRST).
// Uncapped (no length limit), exported so the tests can time it on very long
// names.
export const matchesHashtagName = (name: string): boolean => {
  let count = 0
  let allWord = true
  let anyAlphabetic = false
  let firstIsWord = false
  let lastIsWord = false
  let innerAlphabeticOrSeparator = false
  // Whether the previous character, if it was not the first, is alphabetic or
  // a separator. It is inner once another character follows it.
  let previousQualifies = false
  for (const char of name) {
    const flags = classify(char)
    if (!(flags & (IS_WORD | IS_SEPARATOR))) return false
    if (previousQualifies) innerAlphabeticOrSeparator = true
    previousQualifies =
      count > 0 && (flags & (IS_ALPHABETIC | IS_SEPARATOR)) > 0
    if (!(flags & IS_WORD)) allWord = false
    if (flags & IS_ALPHABETIC) anyAlphabetic = true
    if (count === 0) firstIsWord = (flags & IS_WORD) > 0
    lastIsWord = (flags & IS_WORD) > 0
    count++
  }
  if (allWord && anyAlphabetic) return true
  return count >= 3 && firstIsWord && lastIsWord && innerAlphabeticOrSeparator
}

export const isValidHashtagName = (name: string): boolean =>
  name.length > 0 &&
  name.length <= MAX_TAG_FIELD_LENGTH &&
  matchesHashtagName(name)

/**
 * Hashtag names are stored with their leading `#`. Misskey, Pleroma/Akkoma and
 * others send the bare word, so the prefix is added when it is missing. Like
 * Mastodon's HashtagNormalizer, leading `#` characters are removed first, and
 * so is every character that is not alphabetic, a decimal digit, a Thai mark
 * (U+0E47 to U+0E4E) or a separator (`foo-bar` becomes `foobar`). Mastodon
 * also validates the folded form: NFKC and lowercase of the raw name, with
 * invalid characters stripped afterwards. Both must pass
 * `isValidHashtagName`'s shape rule (`ŀ` folds to `l·`, which ends in a
 * separator). A name Mastodon would not accept or one too long to store gives
 * ''.
 */
export const normalizeHashtagName = (name: string): string => {
  const raw = name.trim().replace(/^#+/, '')
  const bare = raw.replace(HASHTAG_INVALID_CHARS_RE, '')
  // +1 for the stored `#`.
  if (bare.length + 1 > MAX_TAG_FIELD_LENGTH || !isValidHashtagName(bare)) {
    return ''
  }
  // Mastodon's HashtagNormalizer folds the RAW name (NFKC, lowercase) first and
  // only then strips invalid characters and validates.
  const folded = raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(HASHTAG_INVALID_CHARS_RE, '')
  if (!folded || !matchesHashtagName(folded)) return ''
  return `#${bare}`
}

type PlannedTag = {
  name: string
  value: string
  type: 'emoji' | 'hashtag' | 'mention'
}

/**
 * The tags a remote note carries, validated and de-duplicated, without touching
 * the database. Hashtags that Mastodon would not accept and any tag whose name
 * or value cannot be stored are left out; hashtags are de-duplicated
 * case-insensitively.
 */
export const planNoteTags = (note: BaseNote): PlannedTag[] => {
  const seenHashtags = new Set<string>()
  const planned: PlannedTag[] = []
  for (const item of getTags(note)) {
    let tag: PlannedTag
    if (item.type === 'Emoji') {
      tag = { name: item.name, value: item.icon.url, type: 'emoji' }
    } else if (item.type === 'Hashtag') {
      const name = normalizeHashtagName(item.name || '')
      if (!name) continue
      const key = name.slice(1).toLowerCase()
      if (seenHashtags.has(key)) continue
      seenHashtags.add(key)
      const href = (item.href || '').trim()
      tag = { name, value: isHttpUrl(href) ? href : '', type: 'hashtag' }
    } else {
      tag = { name: item.name || '', value: item.href, type: 'mention' }
    }
    if (
      tag.name.length > MAX_TAG_FIELD_LENGTH ||
      tag.value.length > MAX_TAG_FIELD_LENGTH
    ) {
      continue
    }
    planned.push(tag)
  }
  return planned
}

/**
 * Stores planned tags. One tag that cannot be stored is logged and skipped, and
 * never fails the rest. Returns the hashtag names that were stored.
 */
export const storePlannedTags = async ({
  database,
  statusId,
  tags
}: {
  database: Database
  statusId: string
  tags: PlannedTag[]
}): Promise<string[]> => {
  const stored: string[] = []
  await Promise.all(
    tags.map(async (tag) => {
      try {
        await database.createTag({
          statusId,
          name: tag.name,
          value: tag.value,
          type: tag.type,
          ...(tag.type === 'hashtag' ? { skipSearchIndex: true } : undefined)
        })
        if (tag.type === 'hashtag') stored.push(tag.name)
      } catch (error) {
        logger.warn({
          message: 'Skipping a remote note tag that could not be stored',
          statusId,
          tagType: tag.type,
          tagName: tag.name,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    })
  )
  return stored
}

/**
 * Stores the emoji, hashtag and mention tags a remote note carries. Invalid
 * hashtags are skipped and one tag that cannot be stored never fails the note
 * (`getTags` already drops tags that are not valid known kinds). Returns the
 * stored hashtag names (with `#`, de-duplicated case-insensitively) so callers
 * can move counters and refresh hashtag search once.
 */
export const persistNoteTags = async ({
  database,
  statusId,
  note
}: {
  database: Database
  statusId: string
  note: BaseNote
}): Promise<string[]> =>
  storePlannedTags({ database, statusId, tags: planNoteTags(note) })
