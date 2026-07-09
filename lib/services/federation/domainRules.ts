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
  const length = domain.length
  const visibleRatio = Math.floor(length / 4)
  return [...domain]
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
