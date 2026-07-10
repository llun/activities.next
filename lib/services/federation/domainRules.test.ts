import { DomainBlock } from '@/lib/types/database/operations'

import {
  domainDigest,
  domainMatchesRule,
  findMatchingDomainRule,
  isDomainBlockStricter,
  normalizeActorHost,
  normalizeDomain,
  toPublicDomainBlock
} from './domainRules'

describe('domainRules', () => {
  // Mirrors Mastodon's DomainBlock#stricter_than?: suspend always wins, a lower
  // severity never does, and otherwise the candidate must not relax
  // reject_media/reject_reports (so an equal-severity block that adds a flag is
  // stricter, and one that drops a flag is not).
  const strictness = (
    severity: 'noop' | 'silence' | 'suspend',
    rejectMedia = false,
    rejectReports = false
  ) => ({ severity, rejectMedia, rejectReports })

  it.each([
    {
      description: 'suspend is stricter than silence',
      candidate: strictness('suspend'),
      existing: strictness('silence'),
      expected: true
    },
    {
      description: 'suspend is stricter even when it relaxes reject_media',
      candidate: strictness('suspend', false),
      existing: strictness('silence', true),
      expected: true
    },
    {
      description: 'silence is stricter than noop',
      candidate: strictness('silence'),
      existing: strictness('noop'),
      expected: true
    },
    {
      description: 'equal severity with equal flags is not a relaxation',
      candidate: strictness('silence'),
      existing: strictness('silence'),
      expected: true
    },
    {
      description: 'equal severity that adds reject_media is stricter',
      candidate: strictness('silence', true),
      existing: strictness('silence', false),
      expected: true
    },
    {
      description: 'equal severity that adds reject_reports is stricter',
      candidate: strictness('silence', false, true),
      existing: strictness('silence', false, false),
      expected: true
    },
    {
      description: 'equal severity that drops reject_media is not stricter',
      candidate: strictness('silence', false),
      existing: strictness('silence', true),
      expected: false
    },
    {
      description: 'equal severity that drops reject_reports is not stricter',
      candidate: strictness('silence', false, false),
      existing: strictness('silence', false, true),
      expected: false
    },
    {
      description: 'silence is not stricter than suspend',
      candidate: strictness('silence'),
      existing: strictness('suspend'),
      expected: false
    },
    {
      description: 'noop is not stricter than silence',
      candidate: strictness('noop'),
      existing: strictness('silence'),
      expected: false
    }
  ])('$description', ({ candidate, existing, expected }) => {
    expect(isDomainBlockStricter(candidate, existing)).toBe(expected)
  })

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

  // User-level domain blocks are compared against `new URL(actorId).host`, which
  // keeps a non-default port; normalizeActorHost must reproduce that exact form
  // (unlike normalizeDomain, which drops the port via URL.hostname) so a block on
  // a port-bearing instance actually applies.
  it.each([
    {
      description: 'lowercases a bare domain',
      input: 'Example.Social',
      expected: 'example.social'
    },
    {
      description: 'extracts the host from a full URL',
      input: 'https://Sub.Example.Social/path',
      expected: 'sub.example.social'
    },
    {
      description: 'retains a non-default port to match new URL(id).host',
      input: 'dev.example:8443',
      expected: 'dev.example:8443'
    },
    {
      description: 'drops the default https port, matching .host',
      input: 'dev.example:443',
      expected: 'dev.example'
    },
    {
      description: 'strips a trailing dot while keeping the port',
      input: 'DEV.Example.:8443',
      expected: 'dev.example:8443'
    },
    {
      description: 'returns null for an empty value',
      input: '',
      expected: null
    },
    {
      description: 'returns null for an unparseable value',
      input: 'not a domain !!',
      expected: null
    }
  ])('normalizeActorHost $description', ({ input, expected }) => {
    expect(normalizeActorHost(input)).toBe(expected)
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
