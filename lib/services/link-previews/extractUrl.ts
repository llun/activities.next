import { htmlToDOM } from 'html-react-parser'
import { Token, Tokens } from 'marked'

import { createStatusMarked } from '@/lib/utils/text/convertMarkdownText'

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
 * host lowercased, default port and fragment dropped. The path and query keep
 * their case because they are case-sensitive on most servers.
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
    // Tables and lists carry their children on other keys.
    const items = (token as { items?: Token[] }).items
    if (items) collectMarkdownLinks(items, hrefs)
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

type DomNode = {
  type?: string
  name?: string
  attribs?: Record<string, string>
  children?: DomNode[]
}

const isNonContentAnchor = (attribs: Record<string, string>): boolean => {
  const rel = (attribs.rel ?? '').toLowerCase().split(/\s+/)
  if (rel.includes('tag')) return true
  const classNames = (attribs.class ?? '').toLowerCase().split(/\s+/)
  return NON_CONTENT_ANCHOR_CLASSES.some((marker) =>
    classNames.includes(marker)
  )
}

const collectHtmlLinks = (nodes: DomNode[], hrefs: string[]) => {
  for (const node of nodes) {
    if (node.type === 'tag' && node.name === 'a') {
      const attribs = node.attribs ?? {}
      const href = attribs.href
      if (href && !isNonContentAnchor(attribs)) hrefs.push(href)
    }
    if (node.children) collectHtmlLinks(node.children, hrefs)
  }
}

const extractFromHtml = (html: string): string[] => {
  const hrefs: string[] = []
  try {
    collectHtmlLinks(htmlToDOM(html) as DomNode[], hrefs)
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
