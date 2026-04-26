import {
  domainDigest,
  domainMatchesRule,
  findMatchingDomainRule,
  normalizeDomain,
  toPublicDomainBlock
} from './domainRules'

describe('domainRules', () => {
  it('normalizes domains from bare domains and URLs', () => {
    expect(normalizeDomain('Example.Social')).toBe('example.social')
    expect(normalizeDomain('https://Sub.Example.Social/path')).toBe(
      'sub.example.social'
    )
    expect(normalizeDomain('')).toBeNull()
  })

  it('matches exact domains, subdomains, and wildcard allows', () => {
    expect(domainMatchesRule('example.social', 'example.social')).toBe(true)
    expect(domainMatchesRule('sub.example.social', 'example.social')).toBe(true)
    expect(domainMatchesRule('example.social', '*.example.social')).toBe(false)
    expect(domainMatchesRule('sub.example.social', '*.example.social')).toBe(
      true
    )
    expect(domainMatchesRule('anything.test', '*')).toBe(true)
  })

  it('finds the most specific matching rule', () => {
    const match = findMatchingDomainRule('sub.example.social', [
      { id: '1', type: 'block' as const, domain: 'example.social' },
      { id: '2', type: 'block' as const, domain: 'sub.example.social' }
    ])

    expect(match?.id).toBe('2')
  })

  it('obfuscates public domain blocks with the digest', () => {
    const publicBlock = toPublicDomainBlock({
      id: '1',
      type: 'block',
      domain: 'blocked.test',
      severity: 'suspend',
      rejectMedia: false,
      rejectReports: false,
      privateComment: null,
      publicComment: 'spam',
      obfuscate: true,
      source: null,
      createdAt: 0,
      updatedAt: 0
    })

    expect(publicBlock).toEqual({
      domain: domainDigest('blocked.test'),
      digest: domainDigest('blocked.test'),
      severity: 'suspend',
      comment: 'spam'
    })
  })
})
