import { htmlToPlainText } from '@/lib/utils/text/htmlToPlainText'

import { REPLY_SENTINEL } from './replyMarker'

export interface ReplyBodyInput {
  text?: string | null
  html?: string | null
}

// A quoted line: any run of '>' markers, optionally indented and separated by
// spaces ('> > nested').
const QUOTE_PREFIX = /^[ \t]*(?:>[ \t]?)+/
// "On <date>, <someone> wrote:" and its common localisations. Clients wrap it
// over as many as three lines, so the tail is matched against a small joined
// window rather than a single line.
const ATTRIBUTION_OPENER = /^(On|Le|Am|El)\b/
const ATTRIBUTION_CLOSER = /\bwrote:$/
const ATTRIBUTION_MAX_LINES = 3
// The attribution opener when it trails the sender's text on the SAME line —
// the normal shape once htmlToPlainText has collapsed an HTML reply onto one
// line. Scanned globally so the LAST opener can be chosen: a single regex
// anchored only at its end matches leftmost, which cut at the sender's own
// first "On …" sentence and silently published a truncated post.
const INLINE_ATTRIBUTION_OPENER = /(?:^|\s)(?:On|Le|Am|El)\s/g
// Outlook's HTML reply has no underscore rule — it emits `<hr>`, which
// htmlToPlainText drops — so this header run is the only marker left. The
// whole From/Sent-or-Subject sequence is required so an ordinary sentence
// mentioning "From:" is not mistaken for it.
const INLINE_HEADER_RUN = /(?:^|\s)From:\s.*?\b(?:Sent|Subject):\s/
const ORIGINAL_MESSAGE =
  /^-{2,}\s*(Original Message|Forwarded message)\s*-{2,}$/i
// Outlook separates the quoted original with a rule of underscores.
const OUTLOOK_DIVIDER = /^_{5,}$/
// RFC 3676 §4.3 signature delimiter: two dashes and a space on a line of its
// own. Some clients drop the trailing space, so it is optional here.
const SIGNATURE_DELIMITER = /^--\s?$/
// U+00A0. HTML mail is full of them, and a line of them is not "blank" to
// String.trim, so the delimiters above would stop matching.
const NON_BREAKING_SPACE = /\u00a0/g

const stripQuote = (line: string) => line.replace(QUOTE_PREFIX, '')
const cleaned = (line: string) => stripQuote(line).trim()

const normalize = (value: string) =>
  value.replace(/\r\n?/g, '\n').replace(NON_BREAKING_SPACE, ' ')

/**
 * Cut at the sentinel our own notification emails carry.
 *
 * A substring cut rather than a line cut, deliberately: when the body came from
 * HTML, `htmlToPlainText` has collapsed the whole message onto one line, and
 * the reply sits on that same line just ahead of the sentinel. Dropping the
 * matching *line* would throw the reply away with it.
 */
const cutAtSentinel = (value: string) => {
  const index = value.indexOf(REPLY_SENTINEL)
  return index === -1 ? null : value.slice(0, index)
}

// Cut at an "-----Original Message-----" / "---- Forwarded message ----" rule
// or Outlook's underscore divider, wherever it appears.
//
// Applied even when the sentinel was found, because Outlook puts an unquoted
// header block (divider, From:, Sent:, Subject:) BETWEEN the reply and the
// quoted original — so the sentinel cut alone leaves that block behind, and it
// is not `>`-quoted, so the tail cleanup does not remove it either. These
// dividers are unambiguous: they do not occur in ordinary prose, unlike the
// "…wrote:" heuristic below.
const cutAtDivider = (lines: string[]) => {
  for (let index = 0; index < lines.length; index += 1) {
    const value = cleaned(lines[index])
    if (ORIGINAL_MESSAGE.test(value) || OUTLOOK_DIVIDER.test(value)) {
      return lines.slice(0, index)
    }
    // The same header block, but inline — an Outlook reply that arrived as
    // HTML and has been collapsed onto one line.
    const headerRun = INLINE_HEADER_RUN.exec(lines[index])
    if (headerRun) {
      return [...lines.slice(0, index), lines[index].slice(0, headerRun.index)]
    }
  }
  return lines
}

// Fallback for a message with no sentinel (a forward, or a client that
// rewrapped the body): cut at the first attribution header anywhere in the
// text. Only used when the sentinel is missing — a precise cut must never be
// second-guessed by a heuristic that would also fire on "…he wrote:" inside
// someone's actual reply.
const cutAtAttribution = (lines: string[]) => {
  for (let index = 0; index < lines.length; index += 1) {
    const line = cleaned(lines[index])
    if (!ATTRIBUTION_OPENER.test(line)) continue

    for (let span = 0; span < ATTRIBUTION_MAX_LINES; span += 1) {
      const joined = lines
        .slice(index, index + span + 1)
        .map(cleaned)
        .join(' ')
      if (ATTRIBUTION_CLOSER.test(joined)) return lines.slice(0, index)
    }
  }
  return lines
}

const dropTrailingBlankAndQuotedLines = (lines: string[]) => {
  let end = lines.length
  while (end > 0) {
    const line = lines[end - 1]
    if (line.trim() === '' || QUOTE_PREFIX.test(line)) {
      end -= 1
      continue
    }
    break
  }
  return lines.slice(0, end)
}

// Remove an attribution header sitting at the very end of the kept text. After
// a sentinel cut this is what is left of "On … wrote:" immediately above the
// quoted original.
const dropTrailingAttribution = (lines: string[]) => {
  if (lines.length === 0) return lines

  const lastIndex = lines.length - 1
  const last = cleaned(lines[lastIndex])
  if (ORIGINAL_MESSAGE.test(last) || OUTLOOK_DIVIDER.test(last)) {
    return lines.slice(0, -1)
  }
  if (!ATTRIBUTION_CLOSER.test(last)) return lines

  // Walk back for the "On …" opener the closer belongs to, so a wrapped
  // attribution is removed whole rather than leaving its first line behind.
  for (let span = 0; span < ATTRIBUTION_MAX_LINES; span += 1) {
    const start = lastIndex - span
    if (start < 0) break
    if (ATTRIBUTION_OPENER.test(cleaned(lines[start]))) {
      return lines.slice(0, start)
    }
  }

  // No opener on a line of its own, so the attribution trails the sender's
  // text on this line. Cut at the LAST opener rather than the first: the
  // sender's own sentences may well start with "On …" or "Am …", and leaving a
  // stray date fragment in the post is far better than deleting words they
  // actually wrote.
  let inlineStart = -1
  for (const match of lines[lastIndex].matchAll(INLINE_ATTRIBUTION_OPENER)) {
    inlineStart = match.index
  }
  if (inlineStart >= 0) {
    return [
      ...lines.slice(0, lastIndex),
      lines[lastIndex].slice(0, inlineStart)
    ]
  }

  // Ends in "wrote:" but nothing marks it as an attribution header — it is the
  // sender's own sentence ("Here is what she wrote:"). Dropping the line here
  // is what used to throw away the whole of an HTML-only reply.
  return lines
}

const dropSignature = (lines: string[]) => {
  const index = lines.findIndex((line) => SIGNATURE_DELIMITER.test(line))
  return index === -1 ? lines : lines.slice(0, index)
}

const trimBlankEdges = (lines: string[]) => {
  let start = 0
  let end = lines.length
  while (start < end && lines[start].trim() === '') start += 1
  while (end > start && lines[end - 1].trim() === '') end -= 1
  return lines.slice(start, end)
}

/**
 * Recover what the sender actually typed from an inbound reply.
 *
 * Prefers the `text/plain` part and falls back to the HTML one. The HTML
 * fallback goes through `htmlToPlainText`, which collapses the message onto a
 * single line, so the *line-based* heuristics (quoted blocks, a whole-line
 * divider) have nothing to bite on there; the sentinel cut and the two inline
 * trims below are what carry that path.
 *
 * Returns an empty string when nothing is left, which callers must treat as
 * "abandon the reply" rather than posting a blank status.
 */
export const extractReplyText = ({ text, html }: ReplyBodyInput): string => {
  const plain =
    typeof text === 'string' && text.trim().length > 0
      ? normalize(text)
      : normalize(htmlToPlainText(html))
  if (plain.trim().length === 0) return ''

  const sentinelCut = cutAtSentinel(plain)
  let lines = cutAtDivider((sentinelCut ?? plain).split('\n'))

  // Without a precise cut point, fall back to finding the quoted original.
  if (sentinelCut === null) lines = cutAtAttribution(lines)

  // The attribution can sit between two quoted blocks, so alternate until the
  // tail stops shrinking. Bounded by the line count, which only ever falls.
  for (;;) {
    const before = lines.length
    lines = dropTrailingAttribution(dropTrailingBlankAndQuotedLines(lines))
    if (lines.length === before) break
  }

  return trimBlankEdges(dropSignature(lines)).join('\n').trim()
}
