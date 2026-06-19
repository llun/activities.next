import { ensureDomainListed, getServedDomains } from './servedDomains'

describe('getServedDomains', () => {
  it('returns just the primary host when there are no trusted hosts', () => {
    expect(getServedDomains({ host: 'llun.social' })).toEqual([
      { domain: 'llun.social', primary: true }
    ])
  })

  it('lists the primary first, then trusted hosts', () => {
    expect(
      getServedDomains({
        host: 'llun.social',
        trustedHosts: ['social.llun.dev', 'llun.photos']
      })
    ).toEqual([
      { domain: 'llun.social', primary: true },
      { domain: 'social.llun.dev', primary: false },
      { domain: 'llun.photos', primary: false }
    ])
  })

  it('strips scheme and port and de-duplicates the primary host', () => {
    expect(
      getServedDomains({
        host: 'https://llun.social',
        trustedHosts: ['llun.social:443', 'https://llun.photos/']
      })
    ).toEqual([
      { domain: 'llun.social', primary: true },
      { domain: 'llun.photos', primary: false }
    ])
  })

  it('skips wildcard and unparseable trusted-host entries', () => {
    expect(
      getServedDomains({
        host: 'llun.social',
        trustedHosts: ['*.llun.dev', '   ', 'llun.photos']
      })
    ).toEqual([
      { domain: 'llun.social', primary: true },
      { domain: 'llun.photos', primary: false }
    ])
  })
})

describe('ensureDomainListed', () => {
  const domains = [
    { domain: 'llun.social', primary: true },
    { domain: 'llun.photos', primary: false }
  ]

  it('returns the list unchanged when the domain is already present', () => {
    expect(ensureDomainListed(domains, 'llun.photos')).toBe(domains)
  })

  it('appends a wildcard-matched current host that is not listed', () => {
    expect(ensureDomainListed(domains, 'foo.llun.dev')).toEqual([
      ...domains,
      { domain: 'foo.llun.dev', primary: false }
    ])
  })

  it('returns the list unchanged for an empty domain', () => {
    expect(ensureDomainListed(domains, '')).toBe(domains)
  })
})
