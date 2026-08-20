import { htmlToDOM } from 'html-react-parser'

import { logger } from '@/lib/utils/logger'
import { convertMarkdownText } from '@/lib/utils/text/convertMarkdownText'
import { sanitizeText } from '@/lib/utils/text/sanitizeText'
import { toLoggableError } from '@/lib/utils/toLoggableError'

// `link_previews.url` is a text column, but a URL long enough to be worth
// capping is never a real article link — it is a tracking blob or an attempt to
// bloat the row.
export const MAX_PREVIEW_URL_LENGTH = 2048

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

// Anchors Mastodon-family servers use for mentions and hashtags. Those are
// social-graph links, not content the reader wants a card for, and the class
// markers are the only thing distinguishing them from an ordinary link in
// stored remote HTML.
const NON_CONTENT_ANCHOR_CLASSES = ['mention', 'hashtag', 'u-url']

/**
 * Canonical form of a URL for cache keying and comparison: protocol-checked,
 * host lowercased, default port, fragment and userinfo dropped. The path and
 * query keep their case because they are case-sensitive on most servers.
 *
 * Returns null for anything that is not a usable http(s) URL — that null is
 * what keeps a `javascript:` or `data:` URL out of the fetcher and out of an
 * href downstream.
 */
export const normalizePreviewUrl = (input: string): string | null => {
  const trimmed = input.trim()
  if (!trimmed || trimmed.length > MAX_PREVIEW_URL_LENGTH) return null

  try {
    const url = new URL(trimmed)
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null
    if (!url.hostname) return null
    url.hash = ''
    // `safeRemoteFetch` strips credentials before fetching, so keeping them
    // here would hash two spellings of one page to different cache keys — and
    // would put the credentials in `link_previews.url`, which is served to
    // every viewer as the card's href and its Mastodon `card.url`.
    url.username = ''
    url.password = ''
    const normalized = url.toString()
    if (normalized.length > MAX_PREVIEW_URL_LENGTH) return null
    return normalized
  } catch {
    return null
  }
}

/**
 * Links in a LOCAL status, as the reader will see them.
 *
 * Local statuses store the author's markdown, so this renders it with the very
 * same `convertMarkdownText` the page uses and then walks the result with the
 * HTML collector below — the extractor therefore sees exactly the DOM the
 * reader gets.
 *
 * Walking marked's token tree instead looks simpler and is not: marked
 * flattens raw inline HTML into flat sibling tokens, so a link inside
 * `<span class="hidden">…</span>` has no ancestor to inherit hidden-ness from,
 * and a per-token text check cannot tell it apart from a visible one. That gap
 * let an invisible link beat the visible one below it — and separately, link
 * text written as an entity (`[&#8203;](url)`) reads as non-empty in source
 * while rendering to nothing. Rendering first makes both disappear, because the
 * HTML walker already inherits hidden-ness and the parser already decodes
 * entities.
 *
 * Mentions and hashtags come out of the renderer carrying `u-url mention` and
 * `rel="tag"`, which `isNonContentAnchor` already rejects.
 */
const extractFromMarkdown = (text: string, host: string): string[] => {
  try {
    return extractFromHtml(convertMarkdownText(host)(text))
  } catch (error) {
    // A malformed status must not break posting; it simply gets no card. But it
    // must not be SILENT either: swallowing the throw is how a crash on any
    // post containing a table read as "this post has no links" and survived
    // three review rounds.
    logger.warn({
      message: 'linkPreview: failed to read links from markdown',
      error: error instanceof Error ? error.message : String(error),
      err: toLoggableError(error)
    })
    return []
  }
}

// The classes that hide content, which here is an exhaustive list rather than a
// denylist — and only because `sanitizeText` runs first. Its `allowedClasses`
// reduces the class attribute to a fixed set of fediverse markers, so
// `invisible` is the only hiding class that can still be present by the time
// the walk below happens. Written as a guess at hostile input this could never
// work: the app compiles Tailwind, so an unfiltered class attribute offers
// `sr-only`, `opacity-0`, `size-0` and every other utility in the bundle.
//
// `hidden` is what `cleanClassName` rewrites `invisible` to at render time. It
// is listed so the two agree about what "hidden" means, not because a remote
// server can send it.
const HIDDEN_ANCHOR_CLASSES = ['hidden', 'invisible']

type DomNode = {
  type?: string
  name?: string
  attribs?: Record<string, string>
  children?: DomNode[]
  data?: string
}

const isNonContentAnchor = (attribs: Record<string, string>): boolean => {
  const rel = (attribs.rel ?? '').toLowerCase().split(/\s+/)
  if (rel.includes('tag')) return true
  const classNames = (attribs.class ?? '').toLowerCase().split(/\s+/)
  if (HIDDEN_ANCHOR_CLASSES.some((marker) => classNames.includes(marker))) {
    return true
  }
  return NON_CONTENT_ANCHOR_CLASSES.some((marker) =>
    classNames.includes(marker)
  )
}

const isHiddenNode = (node: DomNode): boolean => {
  const classNames = (node.attribs?.class ?? '').toLowerCase().split(/\s+/)
  return HIDDEN_ANCHOR_CLASSES.some((marker) => classNames.includes(marker))
}

/**
 * The text of a node as the reader actually sees it — descendants the renderer
 * hides contribute nothing.
 *
 * Counting ALL descendant text is not enough. Mastodon splits a long URL across
 * `invisible`/`ellipsis` spans inside the anchor, so some hidden children are
 * normal; but an anchor whose children are *all* hidden renders as literally
 * nothing (`cleanClassName` maps `invisible` onto Tailwind's `hidden`) while
 * still carrying text. Only excluding the hidden ones tells those two apart.
 */
const getVisibleText = (node: DomNode): string => {
  if (node.type === 'text') return node.data ?? ''
  if (isHiddenNode(node)) return ''
  if (!node.children) return ''
  return node.children.map(getVisibleText).join('')
}

// `trim()` removes ECMAScript whitespace, which does NOT include the zero-width
// format characters — so an anchor whose only content is U+200B rendered as
// nothing while still counting as "has visible text".
//
// Unicode's own properties rather than a hand-written list: a denylist of the
// obvious few left SOFT HYPHEN, the Hangul fillers and others one character
// away from the same phishing surface. Three properties, because none of them
// is the whole invisible set on its own:
//
//   Default_Ignorable  the zero-width format characters and the fillers
//   Cf                 adds the interlinear annotation marks (U+FFF9..FFFB),
//                      which are format characters but not default-ignorable
//   Cc                 the C0/C1 controls, which are neither
//
// U+2800 BRAILLE PATTERN BLANK is then named on its own because it belongs to
// none of them: it is an ordinary printing character in category So that
// happens to draw nothing, and it is the likeliest character to be reached for
// here. Widening to `\p{So}` to catch it would take every other braille cell
// with it — U+2801 is the same category — and silently deny a card to any
// anchor labelled in braille.
//
// What this removes from real text is only ever joiners and separators: an
// emoji ZWJ sequence, Persian written with ZWNJ, Thai, CJK and braille that
// actually has dots all keep their characters and therefore their cards.
const INVISIBLE_TEXT_PATTERN =
  /[\p{Default_Ignorable_Code_Point}\p{Cf}\p{Cc}\u2800]/gu

const hasVisibleContent = (text: string): boolean =>
  text.replace(INVISIBLE_TEXT_PATTERN, '').trim().length > 0

const hasVisibleText = (node: DomNode): boolean =>
  hasVisibleContent(getVisibleText(node))

const collectHtmlLinks = (
  nodes: DomNode[],
  hrefs: string[],
  // Hidden-ness is inherited. Checking only the anchor and its descendants left
  // an anchor wrapped in a hidden span fully extractable — and because it comes
  // first in document order it BEAT the genuinely visible link below it, so the
  // reader saw one link and got a card for another.
  insideHidden = false
) => {
  for (const node of nodes) {
    const hidden = insideHidden || isHiddenNode(node)
    if (node.type === 'tag' && node.name === 'a') {
      const attribs = node.attribs ?? {}
      const href = attribs.href
      // An anchor with no visible text renders as nothing at all. Giving it a
      // card would put a full-width clickable block, with an attacker-chosen
      // title and image, under a post whose text shows no such link.
      if (
        href &&
        !hidden &&
        !isNonContentAnchor(attribs) &&
        hasVisibleText(node)
      ) {
        hrefs.push(href)
      }
    }
    if (node.children) collectHtmlLinks(node.children, hrefs, hidden)
  }
}

const extractFromHtml = (html: string): string[] => {
  const hrefs: string[] = []
  try {
    // Sanitize FIRST. Remote status text is stored raw and only sanitized at
    // render, so parsing the stored HTML directly sees markup the reader never
    // will — a `<template>`-wrapped anchor is hoisted ahead of the real link,
    // and `<script>`/`<style>` content is walked as markup. Extracting from the
    // sanitized text is what makes "the card is for a link the reader can see"
    // true for remote posts, the way reusing the renderer's tokenizer makes it
    // true for local ones.
    collectHtmlLinks(htmlToDOM(sanitizeText(html)) as DomNode[], hrefs)
  } catch (error) {
    logger.warn({
      message: 'linkPreview: failed to read links from html',
      error: error instanceof Error ? error.message : String(error),
      err: toLoggableError(error)
    })
    return []
  }
  return hrefs
}

export type ExtractPreviewUrlParams = {
  // Local statuses store the author's markdown; remote ones store the HTML the
  // origin server sent.
  text: string
  isLocalActor: boolean
  host: string
  // URLs that already have their own representation on the post — today the
  // quoted status, whose quote card would otherwise be shadowed by a link card
  // for the same page. Compared after normalization.
  excludeUrls?: string[]
}

/**
 * The single URL a status gets a preview card for: the first eligible link in
 * reading order, matching what Mastodon does.
 */
export const extractPreviewUrl = ({
  text,
  isLocalActor,
  host,
  excludeUrls = []
}: ExtractPreviewUrlParams): string | null => {
  if (!text.trim()) return null

  const excluded = new Set(
    excludeUrls
      .map((url) => normalizePreviewUrl(url))
      .filter((url): url is string => Boolean(url))
  )

  const candidates = isLocalActor
    ? extractFromMarkdown(text, host)
    : extractFromHtml(text)

  for (const candidate of candidates) {
    const normalized = normalizePreviewUrl(candidate)
    if (!normalized) continue
    if (excluded.has(normalized)) continue
    return normalized
  }
  return null
}
