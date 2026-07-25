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
// over as many as three lines, so a small window of CONTIGUOUS lines is joined
// before matching — never across a blank line, which a header never contains.
const ATTRIBUTION_OPENER = /^(On|Le|Am|El)\b/
const ATTRIBUTION_CLOSER = /\bwrote:$/
const ATTRIBUTION_MAX_LINES = 3
/**
 * The single rule that keeps every heuristic below from eating the sender's
 * own prose.
 *
 * "On", "Am", "El", "Le" and "From:" are ordinary English, so shape alone
 * cannot tell a machine-generated header from a sentence. A real attribution
 * always carries an address or a clock time; "On 25 July I asked Alice about
 * the outage and here is what she wrote:" carries neither. Requiring that
 * evidence is what separates the two — matching on shape alone truncated real
 * posts three review rounds running.
 *
 * A bare digit is deliberately NOT enough: a sentence mentioning any date or
 * number satisfied it, which put the whole-line branch back in play and went
 * on deleting the sender's text. Every client probed (Gmail desktop and
 * mobile, Apple Mail, Thunderbird, Outlook.com, Yahoo, Proton) emits an
 * address or an HH:MM in its attribution.
 */
const ATTRIBUTION_EVIDENCE = /@|\d{1,2}:\d{2}/
// The attribution opener when it trails the sender's text on the SAME line —
// the normal shape once htmlToPlainText has collapsed an HTML reply onto one
// line. Scanned globally so the LAST qualifying opener wins: anchoring a single
// regex at its end matches leftmost, which cut at the sender's own first
// "On …" sentence and published the truncated remainder.
const INLINE_ATTRIBUTION_OPENER = /(?:^|\s)(?:On|Le|Am|El)\s/g
/**
 * Outlook's forwarded-header block, inline.
 *
 * Its HTML reply has no underscore rule — it emits `<hr>`, which
 * htmlToPlainText drops — so this run is the only marker left. All three
 * headers are required in order, with bounded gaps.
 *
 * The two gaps are deliberately different sizes. The first stays tight so a
 * sender who types "From: postmaster@…" in their own prose cannot reach the
 * real block further down the line and delete everything in between. The
 * second has to be generous, because Outlook puts `To:` — and often `Cc:` or
 * `Importance:` — between `Sent:` and `Subject:`; at 80 it missed any block
 * with a corporate-length recipient, and the whole header, including the
 * replier's own email address, was published.
 *
 * Bounded rather than lazy-unbounded because an unbounded span rescans the
 * rest of the line for every "From:" on it, which is quadratic on the single
 * multi-megabyte line an HTML body collapses to. Do NOT express the middle as
 * a repeated `(?:…\b(?:To|Cc):)*` group — that backtracks catastrophically.
 */
const INLINE_HEADER_RUN =
  /(?:^|\s)From:[^\n]{0,80}?\b(?:Sent|Date):[^\n]{0,300}?\bSubject:\s/g
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
/**
 * Everything past this is discarded before parsing.
 *
 * The sender's own text is always at the TOP of a reply, so truncating the
 * tail can never lose a word of it — while a body far larger than any status
 * could ever be is pure quoted history. The webhook already caps the request
 * at 10 MB, but `validateStatusContentLimits` only runs on the extracted text,
 * i.e. after this function, so it is no protection for the parser itself.
 */
const MAX_PARSE_CHARS = 256 * 1024

const stripQuote = (line: string) => line.replace(QUOTE_PREFIX, '')
const cleaned = (line: string) => stripQuote(line).trim()

const normalize = (value: string) =>
  value
    .replace(/\r\n?/g, '\n')
    .replace(NON_BREAKING_SPACE, ' ')
    .slice(0, MAX_PARSE_CHARS)

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

// Index of the last inline header run on a line, or -1. Last rather than first
// for the same reason as the attribution opener: an earlier "From:" is far
// more likely to be the sender quoting a header at us than the real block.
const lastHeaderRunIndex = (line: string) => {
  let index = -1
  for (const match of line.matchAll(INLINE_HEADER_RUN)) index = match.index
  return index
}

// Cut at an "-----Original Message-----" / "---- Forwarded message ----" rule,
// Outlook's underscore divider, or an inline header run — wherever it appears.
//
// Applied even when the sentinel was found, because Outlook puts an unquoted
// header block BETWEEN the reply and the quoted original: the sentinel cut
// alone leaves it behind, and it carries no `>` markers, so the quoted-tail
// cleanup does not remove it either.
const cutAtDivider = (lines: string[]) => {
  for (let index = 0; index < lines.length; index += 1) {
    const value = cleaned(lines[index])
    if (ORIGINAL_MESSAGE.test(value) || OUTLOOK_DIVIDER.test(value)) {
      return lines.slice(0, index)
    }
    const headerRun = lastHeaderRunIndex(lines[index])
    if (headerRun >= 0) {
      return [...lines.slice(0, index), lines[index].slice(0, headerRun)]
    }
  }
  return lines
}

/**
 * Does an attribution header start at `index` and, within a few CONTIGUOUS
 * lines, close with "wrote:" and carry date/address evidence?
 *
 * The contiguity matters: joining across a blank line fused a sender's own
 * "On Friday I will be away." with the client's attribution two lines below
 * and deleted the paragraph in between.
 */
const attributionSpan = (lines: string[], index: number) => {
  if (!ATTRIBUTION_OPENER.test(cleaned(lines[index]))) return false

  const parts: string[] = []
  for (let span = 0; span < ATTRIBUTION_MAX_LINES; span += 1) {
    const line = lines[index + span]
    if (line === undefined) break
    const value = cleaned(line)
    if (span > 0 && value === '') break
    parts.push(value)

    const joined = parts.join(' ')
    if (ATTRIBUTION_CLOSER.test(joined) && ATTRIBUTION_EVIDENCE.test(joined)) {
      return true
    }
  }
  return false
}

// Fallback for a message with no sentinel (a forward, or a client that
// rewrapped the body): cut at the first real attribution header. Only used
// when the sentinel is missing — a precise cut must never be second-guessed.
const cutAtAttribution = (lines: string[]) => {
  for (let index = 0; index < lines.length; index += 1) {
    if (attributionSpan(lines, index)) return lines.slice(0, index)
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

  // Walk back over CONTIGUOUS lines for the opener this closer belongs to, so
  // a wrapped attribution goes whole — and stop at a blank line, which a real
  // header never spans.
  for (let span = 0; span < ATTRIBUTION_MAX_LINES; span += 1) {
    const start = lastIndex - span
    if (start < 0) break
    const startValue = cleaned(lines[start])
    if (span > 0 && startValue === '') break
    if (!ATTRIBUTION_OPENER.test(startValue)) continue

    const joined = lines
      .slice(start, lastIndex + 1)
      .map(cleaned)
      .join(' ')
    if (ATTRIBUTION_EVIDENCE.test(joined)) return lines.slice(0, start)
  }

  // No opener on a line of its own, so the attribution trails the sender's
  // text on this line. Cut at the LAST opener whose remainder still looks like
  // a header: the sender's own sentences may well start with "On …" or "Am …",
  // and leaving a stray date fragment in the post is far better than deleting
  // words they actually wrote.
  let inlineStart = -1
  for (const match of lines[lastIndex].matchAll(INLINE_ATTRIBUTION_OPENER)) {
    if (ATTRIBUTION_EVIDENCE.test(lines[lastIndex].slice(match.index))) {
      inlineStart = match.index
    }
  }
  if (inlineStart >= 0) {
    return [
      ...lines.slice(0, lastIndex),
      lines[lastIndex].slice(0, inlineStart)
    ]
  }

  // Ends in "wrote:" but nothing marks it as an attribution header — it is the
  // sender's own sentence ("Here is what she wrote:"). Leave it alone.
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
 * trims are what carry that path.
 *
 * Every heuristic here errs towards keeping too much rather than too little.
 * Leaving a stray fragment of a quoted header in a post is a cosmetic problem;
 * deleting a sentence the sender wrote is silent, published, and irreversible.
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
