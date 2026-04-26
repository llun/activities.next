import crypto from 'crypto'

import {
  DomainAllow,
  DomainBlock,
  DomainBlockSeverity,
  DomainFederationRuleType
} from '@/lib/types/database/operations'

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
    return hasWildcard ? `*.${normalized}` : normalized
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

  return (
    normalizedDomain === normalizedRule ||
    normalizedDomain.endsWith(`.${normalizedRule}`)
  )
}

export const findMatchingDomainRule = <
  T extends { domain: string; type: DomainFederationRuleType }
>(
  domain: string,
  rules: T[]
): T | null =>
  rules
    .filter((rule) => domainMatchesRule(domain, rule.domain))
    .sort((a, b) => b.domain.length - a.domain.length)[0] ?? null

export const shouldSuspendDomainBlock = (block: DomainBlock): boolean =>
  block.severity === 'suspend'

export const toPublicDomainBlock = (block: DomainBlock) => ({
  domain: block.obfuscate ? domainDigest(block.domain) : block.domain,
  digest: domainDigest(block.domain),
  severity: block.severity,
  comment: block.publicComment
})

export const toAdminDomainBlock = (block: DomainBlock) => ({
  id: block.id,
  domain: block.domain,
  digest: domainDigest(block.domain),
  created_at: new Date(block.createdAt).toISOString(),
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
  created_at: new Date(allow.createdAt).toISOString()
})
