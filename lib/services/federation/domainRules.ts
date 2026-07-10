import crypto from 'crypto'

import {
  DomainAllow,
  DomainBlock,
  DomainBlockSeverity,
  DomainFederationRuleType
} from '@/lib/types/database/operations'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

export const FEDERATION_MODE_VALUES = ['open', 'allowlist'] as const
export type FederationMode = (typeof FEDERATION_MODE_VALUES)[number]

export const DEFAULT_DOMAIN_BLOCK_SEVERITY: DomainBlockSeverity = 'suspend'

// Severity strictness order for re-block conflict checks (Mastodon allows a
// new block over a covering rule only when it is stricter).
const DOMAIN_BLOCK_SEVERITY_RANK: Record<DomainBlockSeverity, number> = {
  noop: 0,
  silence: 1,
  suspend: 2
}

export interface DomainBlockStrictness {
  severity: DomainBlockSeverity
  rejectMedia: boolean
  rejectReports: boolean
}

/**
 * Mastodon's `DomainBlock#stricter_than?` (app/models/domain_block.rb): a
 * `suspend` is always stricter; a lower severity never is; and at an equal (or
 * higher-but-not-suspend) severity the candidate counts as stricter only when
 * it does not relax `reject_media`/`reject_reports`. That last clause is what
 * lets an admin escalate e.g. `silence` → `silence + reject_media` over a
 * covering wildcard rule instead of being rejected as a duplicate.
 */
export const isDomainBlockStricter = (
  candidate: DomainBlockStrictness,
  existing: DomainBlockStrictness
): boolean => {
  if (candidate.severity === 'suspend') return true
  if (
    DOMAIN_BLOCK_SEVERITY_RANK[candidate.severity] <
    DOMAIN_BLOCK_SEVERITY_RANK[existing.severity]
  ) {
    return false
  }
  return (
    (candidate.rejectMedia || !existing.rejectMedia) &&
    (candidate.rejectReports || !existing.rejectReports)
  )
}

export const normalizeDomain = (value: string): string | null => {
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return null
  if (trimmed === '*') return '*'

  const hasWildcard = trimmed.startsWith('*.')
  const domainToParse = hasWildcard ? trimmed.slice(2) : trimmed
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(domainToParse)
    ? domainToParse
    : `https://${domainToParse}`

  try {
    const url = new URL(withScheme)
    const normalized = url.hostname.replace(/\.$/, '')
    if (!normalized) return null
    const domain = hasWildcard ? `*.${normalized}` : normalized
    if (domain.length > 255) return null

    return domain
  } catch {
    return null
  }
}

// User-level domain blocks are matched against `new URL(actorId).host` at every
// read site: the timeline filter (`getRelevantStatusDomains`), the relationship
// lookup (`getActorDomain`), and the `follows.actorHost` / `targetActorHost`
// columns the severing query filters on are all populated with `URL.host`, which
// keeps a non-default port. `normalizeDomain` derives the domain from
// `URL.hostname` and drops the port, so a block stored that way could never match
// a port-bearing actor. This variant reconstructs the same `host` form (hostname
// plus a non-default port) so the stored block lines up with those comparison
// values. Default ports (`:443` for https) are dropped by `URL`, matching how
// `.host` renders them. User blocks never carry wildcards (the route rejects
// them), so no wildcard handling is needed here.
export const normalizeActorHost = (value: string): string | null => {
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return null

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`

  try {
    const url = new URL(withScheme)
    const hostname = url.hostname.replace(/\.$/, '')
    if (!hostname) return null
    const host = url.port ? `${hostname}:${url.port}` : hostname
    if (host.length > 255) return null

    return host
  } catch {
    return null
  }
}

export const domainDigest = (domain: string): string =>
  crypto.createHash('sha256').update(domain).digest('hex')

export const domainMatchesRule = (
  domain: string,
  ruleDomain: string
): boolean => {
  const normalizedDomain = normalizeDomain(domain)
  const normalizedRule = normalizeDomain(ruleDomain)
  if (!normalizedDomain || !normalizedRule) return false
  if (normalizedRule === '*') return true
  if (normalizedRule.startsWith('*.')) {
    const parent = normalizedRule.slice(2)
    return normalizedDomain.endsWith(`.${parent}`)
  }

  return normalizedDomain === normalizedRule
}

export const findMatchingDomainRule = <
  T extends { domain: string; type: DomainFederationRuleType }
>(
  domain: string,
  rules: T[]
): T | null =>
  rules
    .filter((rule) => domainMatchesRule(domain, rule.domain))
    .sort((a, b) => {
      const wildcardDiff =
        Number(a.domain.startsWith('*.') || a.domain === '*') -
        Number(b.domain.startsWith('*.') || b.domain === '*')
      if (wildcardDiff !== 0) return wildcardDiff

      return b.domain.length - a.domain.length
    })[0] ?? null

export const shouldSuspendDomainBlock = (block: DomainBlock): boolean =>
  block.severity === 'suspend'

// Mastodon's DomainBlock#public_domain rule (app/models/domain_block.rb):
// keep the first floor(length / 4) + 1 characters, the last floor(length / 4)
// characters, and every '.', starring the rest — e.g. 'example.com' →
// 'exa****.*om'. Clients expect this partially-starred form; the full SHA-256
// stays available in `digest`.
const obfuscateDomain = (domain: string): string => {
  // Count in code points, not UTF-16 units, so the length/index math lines up
  // with the code-point array we map over (matters for IDN domains with astral
  // characters) and matches Mastodon's code-point-based public_domain rule.
  const chars = [...domain]
  const length = chars.length
  const visibleRatio = Math.floor(length / 4)
  return chars
    .map((char, index) =>
      index > visibleRatio && index < length - visibleRatio && char !== '.'
        ? '*'
        : char
    )
    .join('')
}

export const toPublicDomainBlock = (block: DomainBlock) => ({
  domain: block.obfuscate ? obfuscateDomain(block.domain) : block.domain,
  digest: domainDigest(block.domain),
  severity: block.severity,
  comment: block.publicComment
})

export const toAdminDomainBlock = (block: DomainBlock) => ({
  id: block.id,
  domain: block.domain,
  digest: domainDigest(block.domain),
  created_at: getISOTimeUTC(block.createdAt),
  severity: block.severity,
  reject_media: block.rejectMedia,
  reject_reports: block.rejectReports,
  private_comment: block.privateComment,
  public_comment: block.publicComment,
  obfuscate: block.obfuscate,
  source: block.source
})

export const toAdminDomainAllow = (allow: DomainAllow) => ({
  id: allow.id,
  domain: allow.domain,
  created_at: getISOTimeUTC(allow.createdAt)
})
