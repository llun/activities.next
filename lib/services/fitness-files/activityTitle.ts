import { htmlToPlainText } from '@/lib/utils/text/htmlToPlainText'

/**
 * The one-line title the fitness overview's day details show for an activity.
 *
 * Server-only: it reads stored post HTML through `htmlToPlainText`, which
 * sanitises it, so no markup reaches the client.
 */

export const MAX_ACTIVITY_TITLE_LENGTH = 120

const ELLIPSIS = '…'

// Line boundaries in stored post text: an explicit break, the end of a block,
// or a raw newline. Split BEFORE converting to plain text, because
// `htmlToPlainText` folds every boundary into a single space.
const LINE_BREAK_PATTERN =
  /<br\s*\/?>|<\/(?:p|div|li|h[1-6]|blockquote|pre)\s*>|\r?\n/i

// A leading emoji, with its variation selector, skin tone and any ZWJ-joined
// parts, plus the space after it: posts often open with one ("🏃 Morning run"),
// and the day details already show the activity type's own icon.
const LEADING_EMOJI_PATTERN =
  /^(?:\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})*(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})*)*\s*)+/u

const truncate = (value: string) => {
  // By code point, so an emoji or other astral character is never cut in half.
  const characters = Array.from(value)
  if (characters.length <= MAX_ACTIVITY_TITLE_LENGTH) return value
  return `${characters
    .slice(0, MAX_ACTIVITY_TITLE_LENGTH - 1)
    .join('')
    .trimEnd()}${ELLIPSIS}`
}

/**
 * The first non-empty line of some post or description text, as plain text,
 * with a leading emoji removed. `null` when there is no such line.
 */
export const getFirstTextLine = (
  text: string | null | undefined
): string | null => {
  if (!text) return null
  for (const segment of text.split(LINE_BREAK_PATTERN)) {
    const line = htmlToPlainText(segment).replace(LEADING_EMOJI_PATTERN, '')
    if (line) return truncate(line)
  }
  return null
}

export interface ActivityTitleSources {
  /**
   * The linked post's content warning, when it has one. It is shown instead of
   * the body so the overview never reveals text the post itself hides.
   */
  postSummary?: string | null
  /** The linked post's text (stored HTML or plain text). */
  postText?: string | null
  /** The activity's own description from the uploaded file. */
  description?: string | null
  fileName: string
}

/** Shown for a content warning with no plain text of its own. */
export const CONTENT_WARNING_TITLE = 'Content warning'

/**
 * The title for an activity whose post is available: the post's content
 * warning when it has one, else the post's first line, else the file's
 * description, else the file name. Callers whose post is missing or not
 * visible show no title at all rather than calling this, so the UI can say
 * the post is unavailable instead of inventing a name.
 *
 * A post with a content warning never yields its body, even when the warning
 * is only emoji ("⚠️"), which `getFirstTextLine` strips to nothing.
 */
export const getActivityTitle = ({
  postSummary,
  postText,
  description,
  fileName
}: ActivityTitleSources): string => {
  const warning = postSummary?.trim()
  if (warning) {
    return (
      getFirstTextLine(warning) ??
      (truncate(htmlToPlainText(warning)) || CONTENT_WARNING_TITLE)
    )
  }
  return (
    getFirstTextLine(postText) ??
    getFirstTextLine(description) ??
    truncate(fileName.trim())
  )
}
