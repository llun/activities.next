import { htmlToDOM } from 'html-react-parser'
import { Token, Tokens } from 'marked'

import { createStatusMarked } from '@/lib/utils/text/convertMarkdownText'
import { sanitizeText } from '@/lib/utils/text/sanitizeText'

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

// Walk the marked token tree depth-first and yield every link href in document
// order. `mention` and `hashtag` are their own token types, so they never
// appear here.
const collectMarkdownLinks = (tokens: Token[], hrefs: string[]) => {
  for (const token of tokens) {
    if (token.type === 'link') {
      hrefs.push((token as Tokens.Link).href)
    }
    const nested = (token as { tokens?: Token[] }).tokens
    if (nested) collectMarkdownLinks(nested, hrefs)
    // Lists keep their children on `items`, which are ordinary tokens.
    const items = (token as { items?: Token[] }).items
    if (Array.isArray(items)) collectMarkdownLinks(items, hrefs)
    // A GFM table keeps its cells on `header`/`rows`. Those cells are NOT
    // ordinary tokens: each carries its own `header` BOOLEAN, so handing them
    // back to this walker made it try to iterate `true` — which threw, and the
    // caller's catch turned any post containing a table into "no links at all".
    // Walk each cell's `tokens` explicitly instead.
    if (token.type === 'table') {
      const table = token as unknown as {
        header?: { tokens?: Token[] }[]
        rows?: { tokens?: Token[] }[][]
      }
      for (const cell of table.header ?? []) {
        if (Array.isArray(cell?.tokens))
          collectMarkdownLinks(cell.tokens, hrefs)
      }
      for (const row of table.rows ?? []) {
        for (const cell of row ?? []) {
          if (Array.isArray(cell?.tokens)) {
            collectMarkdownLinks(cell.tokens, hrefs)
          }
        }
      }
    }
  }
}

const extractFromMarkdown = (text: string, host: string): string[] => {
  const hrefs: string[] = []
  try {
    collectMarkdownLinks(createStatusMarked(host).lexer(text), hrefs)
  } catch {
    // A malformed status must not break posting; it simply gets no card.
    return []
  }
  return hrefs
}

// Classes this app's own renderer uses to hide content (`cleanClassName` maps
// Mastodon's `invisible` onto Tailwind's `hidden`, and passes an anchor's class
// straight through to the DOM). An anchor carrying one of these is not
// something the reader can see or click.
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
const ZERO_WIDTH_PATTERN = /[\u200B-\u200D\u2060\uFEFF]/g

const hasVisibleText = (node: DomNode): boolean =>
  getVisibleText(node).replace(ZERO_WIDTH_PATTERN, '').trim().length > 0

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
  } catch {
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
