// Builds Bluesky rich-text facets (links, #tags, @handle mentions) with UTF-8
// byte offsets. Mentions are resolved to DIDs through the public AppView only;
// unresolved mentions remain plain text.
import { isRecord } from '@/lib/utils/typeGuards'

import { getPublicProfiles } from './appview'
import { DID_PATTERN } from './records'

export type BlueskyFacetFeature =
  | { $type: 'app.bsky.richtext.facet#link'; uri: string }
  | { $type: 'app.bsky.richtext.facet#mention'; did: string }
  | { $type: 'app.bsky.richtext.facet#tag'; tag: string }

export interface BlueskyFacet {
  index: {
    byteStart: number
    byteEnd: number
  }
  features: [BlueskyFacetFeature]
}

interface RawSpan {
  start: number
  end: number
}

interface LinkCandidate extends RawSpan {
  kind: 'link'
  uri: string
}

interface MentionCandidate extends RawSpan {
  kind: 'mention'
  handle: string
}

interface TagCandidate extends RawSpan {
  kind: 'tag'
  tag: string
}

const MAX_HANDLE_LENGTH = 253
const MAX_TAG_BYTES = 640
const MAX_TAG_GRAPHEMES = 64

const textEncoder = new TextEncoder()
const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: 'grapheme'
})

const countGraphemes = (value: string): number => {
  let count = 0
  for (const _ of graphemeSegmenter.segment(value)) {
    count += 1
  }
  return count
}

const utf8Length = (value: string): number =>
  textEncoder.encode(value).byteLength

const overlaps = (a: RawSpan, b: RawSpan): boolean =>
  a.start < b.end && b.start < a.end

// Trims trailing sentence punctuation and unmatched closing brackets from a
// matched URL candidate, keeping balanced parentheses (e.g. Wikipedia links).
const trimUrlCandidate = (raw: string): string => {
  let url = raw
  while (url.length > 0) {
    const last = url[url.length - 1]
    if (/[.,;:!?'"\u2019\u201d]/.test(last)) {
      url = url.slice(0, -1)
      continue
    }
    if (last === ')' || last === ']' || last === '}') {
      const open = last === ')' ? '(' : last === ']' ? '[' : '{'
      const openCount = url.split(open).length - 1
      const closeCount = url.split(last).length - 1
      if (closeCount > openCount) {
        url = url.slice(0, -1)
        continue
      }
    }
    break
  }
  return url
}

const isValidHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value)
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.hostname.length > 0
    )
  } catch {
    return false
  }
}

const LINK_REGEX = /(^|[\s([<"'\u2018\u201c])(https?:\/\/[^\s<>]+)/g

const findLinks = (text: string): LinkCandidate[] => {
  const links: LinkCandidate[] = []
  for (const match of text.matchAll(LINK_REGEX)) {
    const prefix = match[1]
    const rawUrl = match[2]
    const start = (match.index ?? 0) + prefix.length
    const trimmed = trimUrlCandidate(rawUrl)
    if (!trimmed || !isValidHttpUrl(trimmed)) continue
    links.push({
      kind: 'link',
      start,
      end: start + trimmed.length,
      uri: trimmed
    })
  }
  return links
}

// ATProto handle syntax: dot-separated ASCII hostname labels, final TLD label
// starting with a letter. Boundary prevents matching email addresses
// (user@example.com) or Fediverse double-@ handles (@user@bsky.app).
const HANDLE_TLD_REGEX = /^[a-zA-Z][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]?$/
const MENTION_REGEX =
  /(^|[^\p{L}\p{N}_.@/-])(@([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+))/gu
const BSKY_ACCT_MENTION_REGEX =
  /(^|[^\p{L}\p{N}_.@/-])(@([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+))@bsky\.app(?![a-zA-Z0-9@-]|\.[a-zA-Z0-9])/giu

/**
 * Rewrites Mastodon-style `@<handle>@bsky.app` mentions (prefilled by Mastodon
 * clients from a Bluesky account's `handle@bsky.app` acct) to `@<handle>`,
 * skipping URLs and invalid handles.
 */
export const normalizeBlueskyMentions = (text: string): string => {
  if (!text.toLowerCase().includes('@bsky.app')) return text
  const links = findLinks(text)
  return text.replace(
    BSKY_ACCT_MENTION_REGEX,
    (
      match,
      prefix: string,
      mention: string,
      handle: string,
      offset: number
    ) => {
      const start = offset + prefix.length
      const end = offset + match.length
      if (links.some((link) => overlaps(link, { start, end }))) {
        return match
      }
      if (handle.length > MAX_HANDLE_LENGTH) return match
      const tld = handle.slice(handle.lastIndexOf('.') + 1)
      if (!HANDLE_TLD_REGEX.test(tld)) return match
      return `${prefix}${mention}`
    }
  )
}

const findMentions = (
  text: string,
  occupied: RawSpan[]
): MentionCandidate[] => {
  const mentions: MentionCandidate[] = []
  for (const match of text.matchAll(MENTION_REGEX)) {
    const prefix = match[1]
    const full = match[2]
    const handle = match[3]
    const start = (match.index ?? 0) + prefix.length
    const end = start + full.length
    // Avoid matching the leading `@user.tld` of `@user.tld@domain` or another
    // handle character immediately following.
    const nextChar = text[end]
    if (nextChar === '@' || (nextChar && /[a-zA-Z0-9-]/.test(nextChar))) {
      continue
    }
    if (handle.length > MAX_HANDLE_LENGTH) continue
    const tld = handle.slice(handle.lastIndexOf('.') + 1)
    if (!HANDLE_TLD_REGEX.test(tld)) continue
    const span = { start, end }
    if (occupied.some((item) => overlaps(item, span))) continue
    mentions.push({
      kind: 'mention',
      start,
      end,
      handle: handle.toLowerCase()
    })
  }
  return mentions
}

const TAG_REGEX = /(^|[^\p{L}\p{M}\p{N}_#])(#([\p{L}\p{M}\p{N}_]+))/gu

const findTags = (text: string, occupied: RawSpan[]): TagCandidate[] => {
  const tags: TagCandidate[] = []
  for (const match of text.matchAll(TAG_REGEX)) {
    const prefix = match[1]
    const full = match[2]
    const tag = match[3]
    const start = (match.index ?? 0) + prefix.length
    const end = start + full.length
    // Purely numeric tokens like #123 are not hashtags in ATProto.
    if (/^\d+$/.test(tag)) continue
    if (utf8Length(tag) > MAX_TAG_BYTES) continue
    if (countGraphemes(tag) > MAX_TAG_GRAPHEMES) continue
    const span = { start, end }
    if (occupied.some((item) => overlaps(item, span))) continue
    tags.push({
      kind: 'tag',
      start,
      end,
      tag
    })
  }
  return tags
}

const resolveMentionDids = async (
  handles: string[]
): Promise<Map<string, string>> => {
  const unique = [...new Set(handles)]
  const resolved = new Map<string, string>()
  if (unique.length === 0) return resolved
  const profiles = await getPublicProfiles(unique)
  for (const profile of profiles) {
    if (!isRecord(profile)) continue
    const { did, handle } = profile
    if (
      typeof did !== 'string' ||
      !DID_PATTERN.test(did) ||
      typeof handle !== 'string'
    ) {
      continue
    }
    resolved.set(handle.toLowerCase(), did)
  }
  return resolved
}

/**
 * Computes sorted, non-overlapping Bluesky facets for `text` using UTF-8 byte
 * offsets. Priority on overlap: links > mentions > tags.
 */
export const buildBlueskyFacets = async (
  text: string
): Promise<BlueskyFacet[]> => {
  if (!text) return []

  const links = findLinks(text)
  const occupied: RawSpan[] = [...links]
  const mentionCandidates = findMentions(text, occupied)

  const didByHandle = await resolveMentionDids(
    mentionCandidates.map((item) => item.handle)
  )
  const mentions: Array<MentionCandidate & { did: string }> = []
  for (const candidate of mentionCandidates) {
    const did = didByHandle.get(candidate.handle)
    if (!did) continue
    mentions.push({ ...candidate, did })
    occupied.push(candidate)
  }

  const tags = findTags(text, occupied)

  const all: Array<{
    start: number
    end: number
    feature: BlueskyFacetFeature
  }> = [
    ...links.map((item) => ({
      start: item.start,
      end: item.end,
      feature: {
        $type: 'app.bsky.richtext.facet#link' as const,
        uri: item.uri
      }
    })),
    ...mentions.map((item) => ({
      start: item.start,
      end: item.end,
      feature: {
        $type: 'app.bsky.richtext.facet#mention' as const,
        did: item.did
      }
    })),
    ...tags.map((item) => ({
      start: item.start,
      end: item.end,
      feature: {
        $type: 'app.bsky.richtext.facet#tag' as const,
        tag: item.tag
      }
    }))
  ]

  all.sort((a, b) => a.start - b.start)

  const facets: BlueskyFacet[] = []
  let lastEnd = 0
  for (const item of all) {
    if (item.start < lastEnd) continue
    const byteStart = utf8Length(text.slice(0, item.start))
    const byteEnd = byteStart + utf8Length(text.slice(item.start, item.end))
    facets.push({
      index: { byteStart, byteEnd },
      features: [item.feature]
    })
    lastEnd = item.end
  }
  return facets
}
