import { DomainBlock } from '@/lib/types/database/operations'

import {
  domainDigest,
  domainMatchesRule,
  findMatchingDomainRule,
  isDomainBlockStricter,
  normalizeDomain,
  toPublicDomainBlock
} from './domainRules'

describe('domainRules', () => {
  it.each([
    { candidate: 'suspend', existing: 'silence', expected: true },
    { candidate: 'silence', existing: 'noop', expected: true },
    { candidate: 'silence', existing: 'silence', expected: false },
    { candidate: 'silence', existing: 'suspend', expected: false },
    { candidate: 'noop', existing: 'silence', expected: false }
  ] as const)(
    'isDomainBlockStricter($candidate, $existing) is $expected',
    ({ candidate, existing, expected }) => {
      expect(isDomainBlockStricter(candidate, existing)).toBe(expected)
    }
  )

  it('normalizes domains from bare domains and URLs', () => {
    expect(normalizeDomain('Example.Social')).toBe('example.social')
    expect(normalizeDomain('https://Sub.Example.Social/path')).toBe(
      'sub.example.social'
    )
    expect(normalizeDomain('*.Example.Social')).toBe('*.example.social')
    expect(normalizeDomain('')).toBeNull()
    expect(
      normalizeDomain(Array.from({ length: 5 }, () => 'a'.repeat(63)).join('.'))
    ).toBeNull()
  })

  it('matches exact domains and wildcard subdomains', () => {
    expect(domainMatchesRule('example.social', 'example.social')).toBe(true)
    expect(domainMatchesRule('sub.example.social', 'example.social')).toBe(
      false
    )
    expect(domainMatchesRule('example.social', '*.example.social')).toBe(false)
    expect(domainMatchesRule('sub.example.social', '*.example.social')).toBe(
      true
    )
    expect(domainMatchesRule('anything.test', '*')).toBe(true)
  })

  it('finds the most specific matching rule', () => {
    const match = findMatchingDomainRule('sub.example.social', [
      { id: '1', type: 'block' as const, domain: 'example.social' },
      { id: '3', type: 'block' as const, domain: '*.example.social' },
      { id: '2', type: 'block' as const, domain: 'sub.example.social' }
    ])

    expect(match?.id).toBe('2')
  })

  const block = (overrides: Partial<DomainBlock>): DomainBlock => ({
    id: '1',
    type: 'block',
    domain: 'blocked.test',
    severity: 'suspend',
    rejectMedia: false,
    rejectReports: false,
    privateComment: null,
    publicComment: 'spam',
    obfuscate: false,
    source: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  })

  it('passes non-obfuscated domains through with their digest', () => {
    expect(toPublicDomainBlock(block({}))).toEqual({
      domain: 'blocked.test',
      digest: domainDigest('blocked.test'),
      severity: 'suspend',
      comment: 'spam'
    })
  })

  it.each([
    {
      description: 'stars the middle of a two-label domain',
      domain: 'example.com',
      expected: 'exa****.*om'
    },
    {
      description: 'keeps dots visible while starring around them',
      domain: 'blocked.test',
      expected: 'bloc***.*est'
    },
    {
      description: 'keeps the edges of a short domain',
      domain: 'ab.cd',
      expected: 'ab.*d'
    },
    {
      // Astral code points count as two UTF-16 units each; the obfuscation must
      // measure/index by code point (9 here, not 13) so an IDN domain is starred
      // correctly rather than off by the surrogate-pair count.
      description: 'stars an IDN domain by code point, not UTF-16 unit',
      domain: '𝔞𝔟𝔠𝔡.test',
      expected: '𝔞𝔟𝔠*.**st'
    }
  ])('$description', ({ domain, expected }) => {
    const publicBlock = toPublicDomainBlock(block({ domain, obfuscate: true }))
    expect(publicBlock.domain).toBe(expected)
    expect(publicBlock.digest).toBe(domainDigest(domain))
  })
})
